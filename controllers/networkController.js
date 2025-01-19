exports.getConnectedNodes = async (req, res) => {
    const driver = req.app.locals.driver;
    const session = driver.session();
    const { email } = req.body;

    try {
        // Get user and their direct connections, plus connections of connections
        const result = await session.run(
            `
            // Match the main user
            MATCH (mainUser:User {email: $email})
            
            // Get direct connections
            OPTIONAL MATCH (mainUser)-[r1:CONNECTED_TO]-(directConn:User)
            
            // Get second-degree connections (connections of connections)
            OPTIONAL MATCH (directConn)-[r2:CONNECTED_TO]-(secondConn:User)
            WHERE secondConn <> mainUser
            
            // Return all data
            RETURN 
                mainUser,
                collect(DISTINCT {
                    node: directConn,
                    relationship: r1
                }) as directConnections,
                collect(DISTINCT {
                    node: secondConn,
                    relationship: r2
                }) as secondDegreeConnections
            `,
            { email }
        );

        // If user doesn't exist
        if (result.records.length === 0) {
            return res.status(404).json({ 
                message: 'User not found' 
            });
        }

        const record = result.records[0];
        const mainUser = record.get('mainUser').properties;
        const directConnections = record.get('directConnections')
            .filter(conn => conn.node !== null);
        const secondDegreeConnections = record.get('secondDegreeConnections')
            .filter(conn => conn.node !== null);

        // Function to count connections for a user
        const getConnectionCount = (email, dirConns) => {
            return dirConns.filter(conn => conn.node.properties.email === email).length;
        };

        // Create nodes array
        const nodes = [
            {
                id: mainUser.email,
                group: 1,
                connections: directConnections.length,
                name: mainUser.name,
                email: mainUser.email,
                bio: "That's you!", // You can store bio in Neo4j if needed
                visible: true
            }
        ];

        // Add direct connections to nodes
        directConnections.forEach(conn => {
            nodes.push({
                id: conn.node.properties.email,
                group: 2,
                connections: getConnectionCount(conn.node.properties.email, directConnections),
                name: conn.node.properties.name,
                email: conn.node.properties.email,
                bio: `Connected user`, // You can store bio in Neo4j if needed
                visible: true
            });
        });

        // Add second-degree connections to nodes
        secondDegreeConnections.forEach(conn => {
            if (!nodes.some(n => n.id === conn.node.properties.email)) {
                nodes.push({
                    id: conn.node.properties.email,
                    group: 3,
                    connections: getConnectionCount(conn.node.properties.email, secondDegreeConnections),
                    name: conn.node.properties.name,
                    email: conn.node.properties.email,
                    bio: `Extended network`, // You can store bio in Neo4j if needed
                    visible: false
                });
            }
        });

        // Create links array
        const links = [
            // Add direct connections
            ...directConnections.map(conn => ({
                source: mainUser.email,
                target: conn.node.properties.email,
                value: conn.relationship.properties.strength || 1
            })),
            // Add connections between direct connections and their connections
            ...secondDegreeConnections.map(conn => ({
                source: conn.node.properties.email,
                target: directConnections.find(dc => 
                    dc.node.properties.email === conn.relationship.start ||
                    dc.node.properties.email === conn.relationship.end
                ).node.properties.email,
                value: conn.relationship.properties.strength || 1
            }))
        ];

        return res.status(200).json({
            nodes,
            links
        });

    } catch (error) {
        console.error('Error in getConnectedNodes:', error);
        return res.status(500).json({ 
            message: 'Error fetching connected nodes', 
            error: error.message 
        });
    } finally {
        await session.close();
    }
};

exports.getConnections = async (req, res) => {
    const driver = req.app.locals.driver;
    const session = driver.session();
    const { email } = req.body;

    try {
        // Get user and their direct connections only
        const result = await session.run(
            `
            // Match the main user
            MATCH (mainUser:User {email: $email})
            
            // Get direct connections
            OPTIONAL MATCH (mainUser)-[r:CONNECTED_TO]-(directConn:User)
                        WITH mainUser, r, directConn  LIMIT 10
            
            // Return main user and direct connections, including their Neo4j internal IDs
            RETURN 
                ID(mainUser) as mainUserId,
                mainUser,
                collect(DISTINCT {
                    nodeId: ID(directConn),
                    node: directConn,
                    relationship: r
                }) as directConnections
            `,
            { email }
        );

        // If user doesn't exist
        if (result.records.length === 0) {
            return res.status(404).json({ 
                message: 'User not found' 
            });
        }

        const record = result.records[0];
        const mainUser = record.get('mainUser').properties;
        const mainUserId = record.get('mainUserId');
        const directConnections = record.get('directConnections')
            .filter(conn => conn.node !== null);

        // Create nodes array with main user and direct connections only
        const nodes = [
            {
                id: mainUserId.low,  // Using Neo4j's internal ID
                group: 1,
                connections: directConnections.length,
                name: mainUser.name,
                email: mainUser.email,
                bio: "That's you!",
                visible: true
            }
        ];

        // Add direct connections to nodes
        directConnections.forEach(conn => {
            nodes.push({
                id: conn.nodeId.low,  // Using Neo4j's internal ID for the connection
                group: 2,
                connections: directConnections.length,
                name: conn.node.properties.name,
                email: conn.node.properties.email,
                bio: `Connected user`,
                visible: true
            });
        });

        // Create links array with connections between main user and their direct connections
        const links = directConnections.map(conn => ({
            source: mainUserId,
            target: conn.nodeId,
            value: conn.relationship?.properties?.strength || 1
        }));

        return res.status(200).json({
            nodes,
            links
        });

    } catch (error) {
        console.error('Error in getConnections:', error);
        return res.status(500).json({ 
            message: 'Error fetching connected nodes', 
            error: error.message 
        });
    } finally {
        await session.close();
    }
};