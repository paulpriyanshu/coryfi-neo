const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const networkController=require('../controllers/networkController')
const searchController=require('../controllers/searchController')




// router.post('/:cluster/',userController.getUsersExceptConnected)
router.post('/create/:cluster', userController.createUser); 
router.post('/network',networkController.getConnectedNodes);
router.post('/getnetwork',networkController.getConnections)
router.post('/connect',userController.createRelationship)
router.post('/search',searchController.search)
router.post('/connectToUser',searchController.connect_to_user)
router.post('/getpathranking',searchController.path_ranking)
router.post('/searchReachableNodes',searchController.searchReachableNodes)
router.get('/getRandomPathsForUsers',searchController.getRandomPathsForUsers)


router.post('/getAllPath',searchController.get_all_paths)

router.post('/deleteConnection',userController.deletedRelationship)

router.post('/create/label/:name',userController.createLabelWithProperties)
router.get('/:cluster', userController.getUsers); 
router.get('/user/:id',searchController.userProfile)

module.exports = router;