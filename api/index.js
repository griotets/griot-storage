const express = require('express')
const serverless = require("serverless-http");
const AWS = require('aws-sdk')
const multer = require('multer')
const fs = require('fs')
const cors = require('cors')
const { v4: uuidv4 } = require('uuid')
require("dotenv").config();

const app = express()
app.use(cors())

const upload = multer({ dest: 'uploads/' })

// Wasabi config (S3-compatible)
const s3 = new AWS.S3({
  endpoint: 'https://s3.us-east-1.wasabisys.com',
  accessKeyId: process.env.VT_ACCESS_KEY,
  secretAccessKey: process.env.VT_SECRET_KEY,
  region: 'us-east-1'
})

// Store SSE connections by ID
const clients = new Map()
app.get("/", (req, res) => res.send("Express on Vercel"));

// SSE route to send upload progress
app.get('/progress/:id', (req, res) => {
  const id = req.params.id
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })
  res.flushHeaders()
  clients.set(id, res)

  req.on('close', () => {
    clients.delete(id)
  })
})

// Upload video to Wasabi
app.post('/upload/:id', upload.single('video'), (req, res) => {
  const id = req.params.id;
  const key = `${req.body.path}/${req.file.originalname}`;
  console.log(req.file)
  const fileStream = fs.createReadStream(req.file.path)

  const params = {
    Bucket: 'griot-videos',
    Key: key,
    Body: fileStream,
    ContentType: 'video/mp4',
    ACL: 'public-read'
  }

  const managedUpload = s3.upload(params)

  managedUpload.on('httpUploadProgress', (evt) => {
    const percent = Math.round((evt.loaded / evt.total) * 100)
    const client = clients.get(id)
    if (client) {
      client.write(`data: ${percent}\n\n`)
    }
  })

  managedUpload.send((err, data) => {
    fs.unlinkSync(req.file.path)
    const client = clients.get(id)
    if (client) {
      client.write(`event: done\ndata: ${data.Location}\n\n`)
      client.end()
    }
    if (err) return res.status(500).json({ error: err })
    res.json({ url: data.Location })
  })
})
app.listen(3000, () => console.log('✅ SSE + Upload server running on port 3000'))

