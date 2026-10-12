require('dotenv').config();

const path = require('path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');

const { connectDatabase } = require('./config/db');
const pagesRoutes = require('./routes/pages');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
app.use(express.json({ limit: '16kb' }));

app.use(express.static(path.join(__dirname, 'public')));

app.use('/', pagesRoutes);
app.use('/api', apiRoutes);

app.use((req, res) => {
  res.status(404).render('pages/404', { pageTitle: 'Page not found' });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  res.status(500).render('pages/error', {
    pageTitle: 'Something went wrong',
    message: 'Please try again in a moment.',
  });
});

connectDatabase();

app.listen(PORT, () => {
  console.log(`InsightFlow app listening on http://localhost:${PORT}`);
});
