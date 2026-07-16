const express = require('express');
const inventoryController = require('../controllers/inventoryController');
const { verifyToken } = require('../middlewares/auth');

const router = express.Router();

router.get('/stock', verifyToken, inventoryController.getStock);
router.get('/ledger', verifyToken, inventoryController.getLedger);
router.post('/simulate', verifyToken, inventoryController.simulateEvents);
router.post('/event', verifyToken, inventoryController.pushEvent);

module.exports = router;
