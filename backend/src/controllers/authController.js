const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const authRepository = require('../repositories/authRepository');
const { JWT_SECRET } = require('../middlewares/auth');

const register = async (req, res, next) => {
  try {
    const { full_name, username, email, password } = req.body;

    const existingUser = await authRepository.getUserByUsernameOrEmail(username);
    if (existingUser) {
      if (existingUser.username === username) {
        return res.status(409).json({ success: false, message: 'Username is already taken' });
      }
    }
    
    const existingEmail = await authRepository.getUserByUsernameOrEmail(email);
    if (existingEmail) {
       if (existingEmail.email === email) {
        return res.status(409).json({ success: false, message: 'Email is already taken' });
       }
    }

    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    const newUser = await authRepository.createUser({
      full_name,
      username,
      email,
      password_hash
    });

    res.status(201).json({ success: true, message: 'User registered successfully', user: { id: newUser.id, username: newUser.username, full_name: newUser.full_name } });
  } catch (err) {
    next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const { identifier, password } = req.body;
    const user = await authRepository.getUserByUsernameOrEmail(identifier);

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, full_name: user.full_name, email: user.email },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({ success: true, token, user: { id: user.id, username: user.username, full_name: user.full_name, email: user.email } });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  register,
  login
};
