const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const router = express.Router();

// 简单的用户验证中间件
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: { code: 'NO_TOKEN', message: '访问令牌缺失' }
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        error: { code: 'INVALID_TOKEN', message: '无效的访问令牌' }
      });
    }
    req.user = user;
    next();
  });
};

// 登录
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: { code: 'MISSING_CREDENTIALS', message: '用户名和密码不能为空' }
      });
    }

    // 验证用户名和密码
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
      return res.status(500).json({
        error: { code: 'CONFIG_ERROR', message: '服务器配置错误' }
      });
    }

    if (username !== adminUsername) {
      return res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' }
      });
    }

    // 验证密码 - 支持明文密码或bcrypt加密密码
    let isValidPassword = false;
    if (adminPassword.startsWith('$2b$')) {
      // bcrypt加密密码
      isValidPassword = await bcrypt.compare(password, adminPassword);
    } else {
      // 明文密码
      isValidPassword = password === adminPassword;
    }

    if (!isValidPassword) {
      return res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' }
      });
    }

    // 生成JWT令牌
    const token = jwt.sign(
      { 
        id: 1, 
        username: adminUsername,
        type: 'admin'
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: 1,
        username: adminUsername,
        type: 'admin'
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '登录过程中发生错误' }
    });
  }
});

// 登出
router.post('/logout', authenticateToken, (req, res) => {
  // JWT是无状态的，登出主要由客户端删除token实现
  res.json({ success: true, message: '登出成功' });
});

// 验证令牌
router.get('/verify', authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.id,
      username: req.user.username,
      type: req.user.type
    }
  });
});

// 刷新令牌
router.post('/refresh', authenticateToken, (req, res) => {
  const newToken = jwt.sign(
    { 
      id: req.user.id, 
      username: req.user.username,
      type: req.user.type
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );

  res.json({
    success: true,
    token: newToken
  });
});

// 导出认证中间件供其他路由使用
router.authenticateToken = authenticateToken;

module.exports = router;