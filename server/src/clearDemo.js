const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const mongoose = require('mongoose');
const M = require('./models');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  // Drop all collections
  for (const c of await mongoose.connection.db.collections()) {
    await c.deleteMany({});
    console.log(`Cleared: ${c.collectionName}`);
  }
  // Re-create admin account only
  const email = (process.env.ADMIN_EMAIL || 'admin@internhub.local').toLowerCase();
  await M.User.create({
    name: process.env.ADMIN_NAME || 'Programme Admin',
    email,
    password: process.env.ADMIN_PASSWORD || 'Admin@12345',
    role: 'superadmin',
  });
  console.log(`\nAll demo data cleared. Admin re-created: ${email}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
