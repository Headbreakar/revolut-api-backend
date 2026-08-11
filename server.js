import 'dotenv/config';
import app from './src/app.js';
import connectDB from './src/config/db.js';

const PORT = process.env.PORT || 3000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Payment API Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to start server:', err);
});
