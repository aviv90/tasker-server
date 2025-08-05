require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');

const taskRoutes = require('./routes/taskRoutes');

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use('/static', express.static(path.join(__dirname, 'public', 'tmp')));

// Routes
app.use('/api', taskRoutes);

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
