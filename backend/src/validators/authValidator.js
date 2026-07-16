const { body, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

const validateLogin = [
  body('identifier').notEmpty().withMessage('Username or Email is required'),
  body('password').notEmpty().withMessage('Password is required'),
  handleValidationErrors
];

const validateRegister = [
  body('full_name').notEmpty().withMessage('Full Name is required'),
  body('username').notEmpty().withMessage('Username is required').isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  handleValidationErrors
];

module.exports = {
  validateLogin,
  validateRegister
};
