const express = require('express');
const neo4j = require('neo4j-driver');
const userRoutes = require('./routes/userRoutes');
const cors = require('cors');

const app = express();

// Replace with your cloud instance credentials
const uri = 'neo4j+s://633c1c86.databases.neo4j.io';
const user = 'neo4j';
const password = 'vjL0px4-2nOIxXC6t_abEbLwe_-Kf45Zv54Yw9JpzHk';

const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));

app.locals.driver = driver;

// Verify connectivity with Neo4j cloud instance
driver.verifyConnectivity()
  .then(() => {
    console.log('Successfully connected to the Neo4j database');
  })
  .catch((error) => {
    console.error('Failed to connect to the Neo4j database:', error);
  });

app.use(cors({
  origin: '*'
}));
app.use(express.json());
app.use('/api/v1/', userRoutes);

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

process.on('SIGINT', async () => {
  await driver.close();
  process.exit(0);
});