const express = require("express");
const serverless = require("serverless-http");
const AWS = require("aws-sdk");
const multer = require("multer");
const fs = require("fs");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const request = require("request");
const mime = require("mime-types"); // Add at the top if not present

require("dotenv").config();

const app = express();
app.use(cors());

const upload = multer({ dest: "uploads/" });

// Wasabi config (S3-compatible)
const s3 = new AWS.S3({
  endpoint: process.env.VT_WASABI_ENDPOINT,
  accessKeyId: process.env.VT_ACCESS_KEY,
  secretAccessKey: process.env.VT_SECRET_KEY,
  region: process.env.VT_WASABI_REGION,
});
const LECTURE_API_BASE = process.env.VITE_APP_DOMAIN_GRIOT_DATA_BASE;
const LECTURE_ENDPOINT = LECTURE_API_BASE + "lectures/";
// Store SSE connections by ID
const clients = new Map();
app.get("/", (req, res) => res.send("Express on Vercel"));

// SSE route to send upload progress
app.get("/progress/:id", (req, res) => {
  const id = req.params.id;
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  clients.set(id, res);

  req.on("close", () => {
    clients.delete(id);
  });
});

// Upload video to Wasabi
// Upload file (video, image, html, pdf, etc.) to Wasabi
app.post("/upload/:id", upload.single("file"), (req, res) => {
  const id = req.params.id;
  const key = `${req.body.path}/${req.file.originalname}`;
  console.log(req.file);
  const fileStream = fs.createReadStream(req.file.path);

  // Detect MIME type based on file extension
  const contentType = mime.lookup(req.file.originalname) || "application/octet-stream";

  const params = {
    Bucket: "griot-videos",
    Key: key,
    Body: fileStream,
    ContentType: contentType,
    ACL: "public-read",
  };

  const managedUpload = s3.upload(params);

  managedUpload.on("httpUploadProgress", (evt) => {
    const percent = Math.round((evt.loaded / evt.total) * 100);
    const client = clients.get(id);
    if (client) {
      client.write(`data: ${percent}\n\n`);
    }
  });

  managedUpload.send((err, data) => {
    fs.unlinkSync(req.file.path);
    const client = clients.get(id);
    if (client) {
      client.write(
        `event: done\ndata: ${data.Location.replace(
          process.env.VT_GRIOT_ENPOINT,
          process.env.VT_CDN_LINK
        )}\n\n`
      );
      client.end();
    }
    if (err) return res.status(500).json({ error: err });
    res.json({
      url: data.Location.replace(
        process.env.VT_GRIOT_ENPOINT,
        process.env.VT_CDN_LINK
      ),
    });
  });
});

/// lOGIQUE OF Streaming

app.get("/video/:lectureId", async (req, res) => {
  const lectureId = req.params.lectureId;
  const range = req.headers.range;

  if (!range) {
    return res.status(400).send("Requires Range header");
  }

  try {
    // Step 1: Fetch lecture data
    const response = await fetch(`${LECTURE_ENDPOINT}${lectureId}`);
    const lecture = await response.json();

    if (!lecture.contentLink) {
      return res.status(404).send("Video not found in lecture");
    }

    const videoUrl = lecture.contentLink;

    // Step 2: Stream video using range header
    const headers = { Range: range };
    request
      .get({ url: videoUrl, headers })
      .on("response", (resp) => {
        const headersToSend = {};
        if (resp.headers["content-type"])
          headersToSend["Content-Type"] = resp.headers["content-type"];
        if (resp.headers["content-length"])
          headersToSend["Content-Length"] = resp.headers["content-length"];
        if (resp.headers["content-range"])
          headersToSend["Content-Range"] = resp.headers["content-range"];
        if (resp.headers["accept-ranges"])
          headersToSend["Accept-Ranges"] = resp.headers["accept-ranges"];

        res.writeHead(resp.statusCode, headersToSend);
      })
      .pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error retrieving lecture or video");
  }
});

app.listen(3000, () =>
  console.log("✅ SSE + Upload server running on port 3000")
);
