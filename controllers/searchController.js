exports.search = async (req, res) => {
    const driver = req.app.locals.driver;
    const session = driver.session();
    const { searchTerm, currentUsername } = req.body;

    // Basic validation
    if (!searchTerm || typeof searchTerm !== "string" || !currentUsername || typeof currentUsername !== "string") {
        return res.status(400).json({ error: "Invalid input: both 'searchTerm' and 'currentUsername' are required and should be strings." });
    }

    try {
        const result = await session.run(
            `
            MATCH (u:User {email: $currentUsername})
            WITH u
            OPTIONAL MATCH (u)-[:FRIENDS]->(friend:User)
            WHERE toLower(friend.name) CONTAINS toLower($searchTerm)
            AND friend.name IS NOT NULL AND friend.email IS NOT NULL
            WITH u, COLLECT({name: friend.name, email: friend.email}) AS directFriends

            OPTIONAL MATCH (u)-[:FRIENDS]->(:User)-[:FRIENDS]->(mutualFriend:User)
            WHERE toLower(mutualFriend.name) CONTAINS toLower($searchTerm)
            AND NOT (u)-[:FRIENDS]->(mutualFriend)
            AND mutualFriend.name IS NOT NULL AND mutualFriend.email IS NOT NULL
            WITH u, directFriends, COLLECT({name: mutualFriend.name, email: mutualFriend.email}) AS mutualFriends

            OPTIONAL MATCH (other:User)
            WHERE toLower(other.name) CONTAINS toLower($searchTerm)
            AND NOT (u)-[:FRIENDS]->(other) AND other <> u
            AND other.name IS NOT NULL AND other.email IS NOT NULL
            WITH directFriends, mutualFriends, COLLECT({name: other.name, email: other.email}) AS otherMatches

            RETURN directFriends + mutualFriends + otherMatches AS results
            `,
            { searchTerm, currentUsername }
        );

        // Filter out users with null name or email in JavaScript, just in case
        const results = result.records.length > 0 
            ? result.records[0].get("results").filter(user => user.name && user.email) 
            : [];

        if (results.length === 0) {
            return res.status(404).json({ message: "No matching users found" });
        } else {
            return res.status(200).json(results);
        }
    } catch (error) {
        console.error("Error executing search query:", error);

        if (error.message.includes("Neo4jError")) {
            if (error.message.includes("Pool is closed")) {
                return res.status(500).json({ error: "Database connection pool is closed. Please try again later." });
            }
            return res.status(500).json({ error: "Database error: " + error.message });
        }

        return res.status(500).json({ error: "An unexpected error occurred while processing the search request." });
    } finally {
        await session.close();
    }
};

exports.searchReachableNodes = async function (req,res) {
    const driver = req.app.locals.driver;
  const session = driver.session();
  const { sourceEmail} = req.body;

  const query = `
    MATCH (source:User {email: $sourceEmail}), (target:User)
    WHERE source <> target
      AND NOT (source)-[:CONNECTED_TO]-(target)
    CALL apoc.algo.allSimplePaths(source, target, 'CONNECTED_TO', 5)
    YIELD path
    WHERE length(path) >= 2 AND length(path) <= 4
    RETURN DISTINCT target.email AS reachableEmail 
  `;

  try {
    const result = await session.run(query, { sourceEmail });
    const emails = result.records.map(record => record.get('reachableEmail'));
    res.status(200).json(emails)
  } catch (err) {
    console.error('Neo4j query failed:', err);
    throw err;
  } finally {
    await session.close();
  }
};

exports.connect_to_user = async (req, res) => {
    const driver = req.app.locals.driver;
    const session = driver.session();
    const { sourceEmail, targetEmail } = req.body;

    // Validate input
    if (!sourceEmail || !targetEmail) {
        return res.status(400).json({ error: 'Please provide both sourceEmail and targetEmail.' });
    }

    try {
        // First, check if both nodes exist
        const checkNodesQuery = `
            MATCH (source:User {email: $sourceEmail}), (target:User {email: $targetEmail})
            RETURN source, target
        `;
        const checkResult = await session.run(checkNodesQuery, {
            sourceEmail,
            targetEmail,
        });

        if (checkResult.records.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'One or both users not found.',
            });
        }

        // Extract source and target node data
        const sourceNodeData = checkResult.records[0].get('source');
        const targetNodeData = checkResult.records[0].get('target');

        const sourceNode = {
            id: sourceNodeData.identity.low,  // Neo4j internal unique ID
            email: sourceNodeData.properties.email,
            name: sourceNodeData.properties.name,
            bio: sourceNodeData.properties.bio || '',  // Default bio if not available
            connections: sourceNodeData.properties.connections || 0, // Adjust as needed
            visible: true,
        };

        const targetNode = {
            id: targetNodeData.identity.low,  // Neo4j internal unique ID
            email: targetNodeData.properties.email,
            name: targetNodeData.properties.name,
            bio: targetNodeData.properties.bio || '',  // Default bio if not available
            connections: targetNodeData.properties.connections || 0, // Adjust as needed
            visible: true,
        };

        // If nodes exist, check if there is a path between them using Dijkstra algorithm
        const result = await session.run(
            `
            MATCH (source:User {email: $sourceEmail}), (target:User {email: $targetEmail})
            CALL apoc.algo.dijkstra(source, target, 'CONNECTED_TO', 'strength') 
            YIELD path, weight
            RETURN [node IN nodes(path) | {id: id(node), properties: properties(node)}] AS intermediateNodes, weight
            `,
            {
                sourceEmail,
                targetEmail,
            }
        );

        if (result.records.length === 0) {
            // No path found, return only the nodes
            return res.json({
                nodes: [sourceNode, targetNode],
                links: [],  // No edges
            });
        }

        const pathData = result.records[0];
        const intermediateNodes = pathData.get('intermediateNodes');
        const weight = pathData.get('weight');

        // Transform intermediate nodes to the desired structure
        const nodes = intermediateNodes.map(node => ({
            id: node.id.low, // Neo4j internal unique ID
            email: node.properties.email,
            group: 1, // Adjust as needed
            connections: node.properties.connections || 0,
            name: node.properties.name,
            bio: node.properties.bio || '',
            visible: true,
        }));

        // Create links from nodes
        const links = [];
        for (let i = 0; i < nodes.length - 1; i++) {
            links.push({
                source: nodes[i].id,
                target: nodes[i + 1].id,
                value: 9, // Adjust based on your logic for link value
            });
        }

        res.json({
            nodes: [sourceNode, targetNode, ...nodes],
            links,
        });
    } catch (error) {
        console.error('Error retrieving path:', error);
        res.status(500).json({ success: false, error: 'An error occurred while retrieving the path.' });
    } finally {
        await session.close();
    }
};
 
exports.path_ranking = async (req, res) => {
    const driver = req.app.locals.driver;
    const session = driver.session();
    const { sourceEmail, targetEmail, pathIndex} = req.body;

    if (!sourceEmail || !targetEmail) {
        return res.status(400).json({ error: 'Please provide both sourceEmail and targetEmail.' });
    }

    try {
        const result = await session.run(
            `
           MATCH (source:User {email: $sourceEmail}), (target:User {email: $targetEmail})
CALL apoc.algo.allSimplePaths(source, target, 'CONNECTED_TO', 8)
YIELD path
RETURN 
    [node IN nodes(path) | {id: id(node), properties: properties(node)}] AS intermediateNodes,
    reduce(total = 0, r IN relationships(path) | total + COALESCE(r.strength, 1)) AS pathStrength,
    [r IN relationships(path) | COALESCE(r.strength, 1)] AS edgeStrengths,
    length(path) AS pathLength
ORDER BY pathLength ASC
            `,
            { sourceEmail, targetEmail }
        );

        if (result.records.length === 0) {
            return res.status(404).json({ message: 'No paths found between users.' });
        }

        const paths = result.records.map((record, index) => {
            const intermediateNodes = record.get('intermediateNodes');
            const edgeStrengths = record.get('edgeStrengths');

            // Create the nodes array with source, target, intermediate nodes
            const nodes = [];
            let sourceNode, targetNode;

            // Identify the source and target node
            intermediateNodes.forEach((node) => {
                if (node.properties.email === sourceEmail) {
                    sourceNode = {
                        id: node.id.low,
                        email: node.properties.email,
                        name: node.properties.name || '',
                        bio: node.properties.bio || '',
                        connections: node.properties.connections || 0,
                        group: 1,  // Ensure 'group' property is included
                        visible: true,
                    };
                } else if (node.properties.email === targetEmail) {
                    targetNode = {
                        id: node.id.low,
                        email: node.properties.email,
                        name: node.properties.name || '',
                        bio: node.properties.bio || '',
                        connections: node.properties.connections || 0,
                        group: 1,  // Ensure 'group' property is included
                        visible: true,
                    };
                } else {
                    nodes.push({
                        id: node.id.low,
                        email: node.properties.email || '',
                        name: node.properties.name || '',
                        bio: node.properties.bio || '',
                        connections: node.properties.connections || 0,
                        group: 1,  // Ensure 'group' property is included
                        visible: true,
                    });
                }
            });

            // Ensure the order is source -> source again -> intermediate nodes -> target -> target again
            const orderedNodes = [
                sourceNode, 
                targetNode, 
                sourceNode, 
                ...nodes, 
                targetNode
            ].filter(Boolean);

            // Generate links from nodes
            const links = [];
            for (let i = 2; i < orderedNodes.length - 1; i++) {
                links.push({
                    source: orderedNodes[i].id,
                    target: orderedNodes[i + 1].id,
                    value: edgeStrengths[i] || 1,
                });
            }

            return { pathIndex: index, nodes: orderedNodes, links };
        });

        // Return the specific path or all paths
        if (pathIndex !== undefined) {
            const selectedPath = paths[pathIndex];
            if (!selectedPath) {
                return res.status(404).json({
                    success: false,
                    message: `Path with index ${pathIndex} not found.`,
                });
            }
            return res.json({
                nodes: selectedPath.nodes,
                links: selectedPath.links,
            });
        }

        // Return all paths
        res.json({
            success: true,
            paths: paths.map((path) => ({
                nodes: path.nodes,
                links: path.links,
            })),
        });
    } catch (error) {
        console.error('Error retrieving paths:', error);
        res.status(500).json({ success: false, error: 'An error occurred while retrieving paths.' });
    } finally {
        await session.close();
    }
};
exports.get_all_paths = async (req, res) => {
    const driver = req.app.locals.driver;
    const session = driver.session();
    const { sourceEmail, targetEmail } = req.body;

    if (!sourceEmail || !targetEmail) {
        return res.status(400).json({ error: 'Please provide both sourceEmail and targetEmail.' });
    }

    try {
        // Query to get all paths between the source and target
        const result = await session.run(
            `
            MATCH (source:User {email: $sourceEmail}), (target:User {email: $targetEmail})
            CALL apoc.algo.allSimplePaths(source, target, 'CONNECTED_TO', 10) 
            YIELD path
            RETURN path, 
                   reduce(weight = 0, rel IN relationships(path) | weight + rel.strength) AS totalWeight, 
                   size(nodes(path)) AS pathLength
            ORDER BY totalWeight ASC
            `,
            { sourceEmail, targetEmail }
        );

        if (result.records.length === 0) {
            return res.status(404).json({ message: 'No paths found between the specified users.' });
        }

        // Process all paths
        const paths = result.records.map(record => {
            const path = record.get('path');
            const totalWeight = record.get('totalWeight');
            const pathLength = record.get('pathLength');

            // Extract nodes
            const nodesSet = new Set();
            const nodes = [];
            const links = [];

            path.segments.forEach(segment => {
                const startNode = segment.start;
                const endNode = segment.end;
                const relationship = segment.relationship;

                // Add start node if not already added
                if (!nodesSet.has(startNode.identity.low)) {
                    nodes.push({
                        id: startNode.identity.low,
                        ...startNode.properties,
                        visible: true,
                    });
                    nodesSet.add(startNode.identity.low);
                }

                // Add end node if not already added
                if (!nodesSet.has(endNode.identity.low)) {
                    nodes.push({
                        id: endNode.identity.low,
                        ...endNode.properties,
                        visible: true,
                    });
                    nodesSet.add(endNode.identity.low);
                }

                // Add the relationship as a link
                links.push({
                    source: startNode.identity.low,
                    target: endNode.identity.low,
                    value: relationship.properties.strength,
                });
            });

            return {
                nodes,
                links,
                totalWeight,
                pathLength,
            };
        });

        res.json({
            paths,
            count: paths.length,
        });
    } catch (error) {
        console.error('Error retrieving paths:', error);
        res.status(500).json({ success: false, error: 'An error occurred while retrieving the paths.' });
    } finally {
        await session.close();
    }
};
exports.userProfile = async (req, res) => {
    const { id } = req.params
  
    // Convert string ID to integer since Neo4j internal IDs are integers
    const userId = parseInt(id, 10)
    console.log(userId)
    
    // Check if the ID is a valid number and not NaN
    if (isNaN(userId) || userId < 0) {
      return res.status(400).json({ error: 'Valid User ID is required' })
    }
  
    // Get driver from app locals
    const driver = req.app.locals.driver
    if (!driver) {
      return res.status(500).json({ error: 'Database connection not available' })
    }
  
    const session = driver.session()
    
    try {
      console.log(userId)
      const result = await session.run(
        'MATCH (u:User) WHERE ID(u) = $userId RETURN u',
        { userId: userId } // Now passing the parsed integer
      )
  
      if (result.records.length === 0) {
        return res.status(404).json({ error: 'User not found' })
      }
  
      const user = result.records[0].get('u').properties
      res.status(200).json(user)
      
    } catch (error) {
      console.error('Neo4j Query Error:', error)
      res.status(500).json({ error: 'Failed to fetch user data' })
      
    } finally {
      await session.close()
    }
  }