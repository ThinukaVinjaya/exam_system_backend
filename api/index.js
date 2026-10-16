const app = require('../dist/app.js').default || require('../dist/app.js');
const { connectDB } = require('../dist/config/db.js');

let isConnected = false;

module.exports = async (req, res) => {
  if (!isConnected) {
    try {
      await connectDB();
      isConnected = true;
    } catch (err) {
      console.error('[Vercel Serverless] MongoDB connection error:', err);
    }
  }

  return app(req, res);
};
