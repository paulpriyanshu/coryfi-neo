exports.getUsers = async (req, res) => {
  const cluster=req.params.cluster
  console.log(cluster)
  const driver = req.app.locals.driver;
  const session = driver.session();


  try {
    // Adjusted query to match 'User' nodes instead of 'Node'
    const result = await session.run(`MATCH (n:${cluster}) RETURN n`);

    // Map over the records to extract both 'name' and 'email' properties
    const users = result.records.map(record => record.get('n').properties);

    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching users', error });
  } finally {
    await session.close();
  }
};
exports.getUsersExceptConnected = async (req, res) => {
  console.log("hihi")
  const cluster = req.params.cluster;
  const email = req.body.email;
  const driver = req.app.locals.driver;
  const session = driver.session();

  try {
    const query = `
      MATCH (n:${cluster})
      WHERE NOT EXISTS {
        MATCH (n)-[:CONNECTED]-(:${cluster} {email: $email})
      } 
      AND n.email <> $email
      RETURN n
    `;

    const result = await session.run(query, { email });
    const users = result.records.map(record => record.get('n').properties);
    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ message: 'Error fetching users', error });
  } finally {
    await session.close();
  }
};
exports.createLabelWithProperties = async (req, res) => {
  const driver = req.app.locals.driver;
  const session = driver.session();
  const { labelName } = req.params;
  const properties = req.body;

  try {
    // Check if the label exists
    const checkLabelQuery = ` 
      CALL db.labels() YIELD label
      WHERE label = $labelName
      RETURN count(label) > 0 AS exists
    `;
    const labelCheckResult = await session.run(checkLabelQuery, { labelName });
    const labelExists = labelCheckResult.records[0].get('exists');

    let message;
    if (labelExists) {
      // If label exists, create a node with the given properties
      const createNodeQuery = `
        CREATE (n:${labelName} $properties)
        RETURN n
      `;
      const result = await session.run(createNodeQuery, { properties });
      const createdNode = result.records[0].get('n').properties;
      message = `Label ${labelName} already exists. Created a new node with the given properties.`;
      res.json({ message, node: createdNode });
    } else {
      // If label doesn't exist, create it with a node and the given properties
      const createLabelAndNodeQuery = `
        CREATE (n:${labelName} $properties)
        RETURN n
      `;
      const result = await session.run(createLabelAndNodeQuery, { properties });
      const createdNode = result.records[0].get('n').properties;
      message = `Label ${labelName} created successfully with a new node.`;
      res.json({ message, node: createdNode });
    }
  } catch (error) {
    console.error(`Error in createLabelWithProperties: ${error}`);
    res.status(500).json({ error: 'An error occurred while creating the label or node.' });
  } finally {
    await session.close();
  }
  
}
exports.createUser = async (req, res) => {
  const cluster = req.params.cluster; // e.g., 'Node'
  const driver = req.app.locals.driver;
  const session = driver.session();

  const { name, email } = req.body;
  console.log("this is cluster", cluster);

  try {
    // Check if a user with the given email already exists in the specified cluster.
    const userExistsResult = await session.run(
      `MATCH (n:${cluster} {email: $email}) RETURN n`,
      { email }
    );

    // If a user already exists, return the existing user
    if (userExistsResult.records.length > 0) {
      const existingUser = userExistsResult.records[0].get('n').properties;
      return res.status(200).json(existingUser);
    }

    // If no user exists, create a new user node
    const result = await session.run(
      `CREATE (n:${cluster} {
        name: $name, 
        email: $email,
        createdAt: datetime()
      }) RETURN n`,
      { name, email }
    );

    // Extract the created user's properties from the result
    const newUser = result.records[0].get('n').properties;

    // Send a success response with the created user data
    return res.status(201).json(newUser);

  } catch (error) {
    console.error('Error in createUser:', error);
    return res.status(500).json({ 
      message: 'Error creating/finding user', 
      error: error.message 
    });
  } finally {
    // Ensure the session is closed after the operation
    await session.close();
  }
};




exports.createRelationship = async (req, res) => {
  const driver = req.app.locals.driver;
  const session = driver.session();
  const { email1, email2, strength } = req.body;
  const weight=10-strength

  // Input validation
  if (!email1 || !email2 || weight === undefined) {
      return res.status(400).json({ 
          message: 'Missing required fields. Need email1, email2, and weight' 
      });
  }

  // Prevent self-connections
  if (email1 === email2) {
      return res.status(400).json({ 
          message: 'Cannot create relationship with self' 
      });
  }

  try {
      // Check if both users exist
      const usersExist = await session.run(
          `
          MATCH (u1:User {email: $email1}), (u2:User {email: $email2})
          RETURN u1, u2
          `,
          { email1, email2 }
      );

      if (usersExist.records.length === 0) {
          return res.status(404).json({ 
              message: 'One or both users not found' 
          });
      }

      // Create a relationship with weight
      const result = await session.run(
          `
          MATCH (u1:User {email: $email1}), (u2:User {email: $email2})
          MERGE (u1)-[r:CONNECTED_TO]->(u2)
          SET r.strength = $weight,
              r.createdAt = datetime()
          RETURN u1, u2, r
          `,
          { 
              email1,
              email2,
              weight: parseFloat(weight) // Ensure weight is a number
          }
      );

      if (result.records.length > 0) {
          const record = result.records[0];
          const user1 = record.get('u1').properties;
          const user2 = record.get('u2').properties;
          const relationship = record.get('r').properties;

          return res.status(201).json({
              message: 'Relationship created successfully',
              relationship: {
                  user1: {
                      email: user1.email,
                      name: user1.name
                  },
                  user2: {
                      email: user2.email,
                      name: user2.name
                  },
                  weight: relationship.strength,
                  createdAt: relationship.createdAt
              }
          });
      }

      return res.status(500).json({ 
          message: 'Failed to create relationship' 
      });

  } catch (error) {
      console.error('Error in createRelationship:', error);
      return res.status(500).json({ 
          message: 'Error creating relationship', 
          error: error.message 
      });
  } finally {
      await session.close();
  }
};

// DELETE route to remove a relationship 
exports.deletedRelationship=async(req, res) => {
  const driver = req.app.locals.driver;
  const session = driver.session();
  const {email1,email2}=req.body
  
  try {
    const result = await session.run( 
      `MATCH (u1:User {email: $email1})-[r:CONNECTED_TO]-(u2:User {email: $email2})
       DELETE r
       RETURN "Relationship deleted successfully" AS message`,
      { email1, email2 }
    );

    const message = result.records.length > 0 ? result.records[0].get('message') : 'No relationship found';
    console.log(message);
    res.json({
      message
    })

  } catch (error) {
    console.error('Error deleting relationship:', error);
    throw error;
  } finally {
    await session.close();
  }
}
