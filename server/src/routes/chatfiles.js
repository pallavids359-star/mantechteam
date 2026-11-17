
// Chat attachments (images, PDFs, any file) + last message per chat.
// A file can only be opened by people who can see that chat.

const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const mongoose = require('mongoose');

const { Message } = require('../models');
const { canUseChannel } = require('../services/channels');
const { broadcastMessage } = require('../services/socket');
const { notifyChat } = require('../services/notify');

const ChatFile = mongoose.models.ChatFile || mongoose.model(
  'ChatFile',
  new mongoose.Schema({
    channel: { type: String, required: true, index: true },
    name: { type: String, required: true },
    storedName: { type: String, required: true },
    mime: { type: String, default: 'application/octet-stream' },
    size: { type: Number, default: 0 },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }, { timestamps: true })
);

const DIR = path.join(__dirname, '..', '..', 'uploads', 'chat');
fs.mkdirSync(DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: DIR,
    filename: (req, file, cb) => {
      cb(
        null,
        crypto.randomBytes(12).toString('hex') +
        path.extname(file.originalname).toLowerCase()
      );
    }
  }),
  limits: {
    fileSize: (+process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024
  }
});

// Last message of each chat
router.get('/last', async (req, res) => {
  const list = String(req.query.ch || '')
    .split(',')
    .filter(Boolean)
    .slice(0, 80)
    .filter((channel) => canUseChannel(req.user, channel));

  const out = {};

  await Promise.all(list.map(async (channel) => {
    const message = await Message.findOne({ channel })
      .sort('-createdAt')
      .populate('from', 'name')
      .populate('file', 'name mime')
      .lean();

    if (message) out[channel] = message;
  }));

  res.json(out);
});

// Open or download a chat file
router.get('/file/:id', async (req, res) => {
  const file = await ChatFile.findById(req.params.id).catch(() => null);

  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  if (!canUseChannel(req.user, file.channel)) {
    return res.status(403).json({ error: 'Not allowed' });
  }

  const full = path.join(DIR, file.storedName);

  if (!fs.existsSync(full)) {
    return res.status(410).json({
      error: 'This file is no longer available'
    });
  }

  if (req.query.download === '1') {
    return res.download(full, file.name);
  }

  res.setHeader('Content-Type', file.mime);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(full);
});

// Upload a file into a chat
router.post(
  '/:channel',
  (req, res, next) => {
    if (!canUseChannel(req.user, req.params.channel, true)) {
      return res.status(403).json({
        error: 'You cannot send messages here'
      });
    }

    next();
  },
  upload.single('file'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file received' });
    }

    const file = await ChatFile.create({
      channel: req.params.channel,
      name: req.file.originalname,
      storedName: req.file.filename,
      mime: req.file.mimetype,
      size: req.file.size,
      uploadedBy: req.user._id
    });

    const message = await Message.create({
      channel: req.params.channel,
      from: req.user._id,
      text: String((req.body && req.body.text) || '').slice(0, 4000),
      file: file._id
    });

    await message.populate('from', 'name role');
    await message.populate('file', 'name mime size');

    broadcastMessage(message);

    await notifyChat(
      req.params.channel,
      req.user,
      req.body?.text || 'Shared an attachment'
    );

    res.status(201).json(message);
  }
);

// CommonJS exports
module.exports = router;
module.exports.router = router;
