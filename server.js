require('dotenv').config();

const path = require('path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');

const { connectDatabase } = require('./config/db');
const pagesRoutes = require('./routes/pages');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(express.static(path.join(__dirname, 'public')));

app.use('/', pagesRoutes);

connectDatabase();

app.listen(PORT, () => {
  console.log(`InsightFlow app listening on http://localhost:${PORT}`);
});
