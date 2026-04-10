const redisClient = require('../config/redis')
const User = require('../models/user')
const validate = require('../utils/validator')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const Submission = require('../models/submission')
const emailService = require('../services/emailService')

const register = async (req, res) => {
  try {
    validate(req.body)
    const { firstName, emailId, password } = req.body

    req.body.password = await bcrypt.hash(password, 10)
    req.body.role = 'user'
    req.body.isVerified = false // User starts as unverified
    req.body.problemSolved = []

    // Generate OTP before creating user so we can store it atomically
    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    req.body.otp = otp
    req.body.otpExpiry = otpExpiry

    const user = await User.create(req.body)

    // Also store in Redis as a fast cache (non-critical — safe proxy handles failures)
    try {
      await redisClient.setEx(`otp:${emailId}`, 600, otp)
    } catch (redisErr) {
      console.warn('⚠️  Redis OTP cache failed (non-fatal, MongoDB is primary):', redisErr.message)
    }

    // Send OTP email
    await emailService.sendOTP(emailId, otp, firstName)

    res.status(201).json({
      requiresVerification: true,
      emailId: emailId,
      userId: user._id,
      message: 'Registration successful. Please check your email for OTP verification.',
    })
  } catch (err) {
    console.error('Registration error:', err)

    if (err.code === 11000) {
      if (err.keyValue && err.keyValue.emailId) {
        return res.status(400).json({
          message: 'Email already exists',
        })
      }

      if (err.message && err.message.includes('problemSolved_1')) {
        return res.status(500).json({
          message:
            'Database configuration error. Please contact administrator to fix database indexes.',
          error: 'problemSolved_index_error',
          suggestion:
            'This is a database index issue that needs to be resolved by dropping the problemSolved_1 index from the users collection.',
        })
      }

      return res.status(400).json({
        message: 'Email already exists',
      })
    }

    if (err.message) {
      return res.status(400).json({
        message: err.message,
      })
    }

    res.status(400).json({
      message: 'Registration failed',
    })
  }
}

const login = async (req, res) => {
  try {
    const { emailId, password } = req.body

    if (!emailId) throw new Error('Invalid Credentials')
    if (!password) throw new Error('Invalid Credentials')

    const user = await User.findOne({ emailId })

    if (!user) {
      throw new Error('Invalid Credentials')
    }

    const match = await bcrypt.compare(password, user.password)

    if (!match) throw new Error('Invalid Credentials')

    const reply = {
      firstName: user.firstName,
      emailId: user.emailId,
      _id: user._id,
      role: user.role,
    }

    const token = jwt.sign(
      { _id: user._id, emailId: emailId, role: user.role },
      process.env.JWT_KEY,
      { expiresIn: 60 * 60 }
    )

    // Configure cookie for production cross-domain
    const cookieOptions = {
      maxAge: 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    }

    res.cookie('token', token, cookieOptions)
    res.status(201).json({
      user: reply,
      message: 'Loggin Successfully',
    })
  } catch (err) {
    console.error('Login error:', err)
    res.status(401).json({
      message: err.message || 'Login failed',
    })
  }
}

const logout = async (req, res) => {
  try {
    const { token } = req.cookies
    const payload = jwt.decode(token)

    // Try to blocklist token in Redis — but don't fail logout if Redis is down
    try {
      if (redisClient.isOpen && payload) {
        await redisClient.set(`token:${token}`, 'Blocked')
        await redisClient.expireAt(`token:${token}`, payload.exp)
      }
    } catch (redisErr) {
      console.warn('⚠️  Redis blocklist failed during logout (non-fatal):', redisErr.message)
    }

    // Configure cookie for logout - same settings as login
    const cookieOptions = {
      expires: new Date(Date.now()),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    }

    res.cookie('token', null, cookieOptions)
    res.send('Logged Out Succesfully')
  } catch (err) {
    res.status(503).send('Error: ' + err)
  }
}

const adminRegister = async (req, res) => {
  try {
    validate(req.body)
    const { firstName, emailId, password } = req.body

    req.body.password = await bcrypt.hash(password, 10)

    const user = await User.create(req.body)
    const token = jwt.sign(
      { _id: user._id, emailId: emailId, role: user.role },
      process.env.JWT_KEY,
      { expiresIn: 60 * 60 }
    )

    // Configure cookie for production cross-domain
    const cookieOptions = {
      maxAge: 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    }

    res.cookie('token', token, cookieOptions)
    res.status(201).send('User Registered Successfully')
  } catch (err) {
    res.status(400).send('Error: ' + err)
  }
}

const deleteProfile = async (req, res) => {
  try {
    const userId = req.result._id

    await User.findByIdAndDelete(userId)

    res.status(200).send('Deleted Successfully')
  } catch (err) {
    res.status(500).send('Internal Server Error')
  }
}

const verifyOTP = async (req, res) => {
  try {
    const { emailId, otp } = req.body

    if (!emailId || !otp) {
      return res.status(400).json({
        message: 'Email and OTP are required'
      })
    }

    // --- Strategy: Redis first (fast), fall back to MongoDB (reliable) ---
    let storedOTP = null
    let otpSource = 'redis'

    // 1. Try Redis cache first
    try {
      storedOTP = await redisClient.get(`otp:${emailId}`)
    } catch (redisErr) {
      console.warn('⚠️  Redis OTP lookup failed, falling back to MongoDB:', redisErr.message)
    }

    // 2. Fall back to MongoDB if Redis missed (not connected / OTP not cached)
    if (!storedOTP) {
      otpSource = 'mongodb'
      const userWithOTP = await User.findOne({ emailId }).select('+otp +otpExpiry')

      if (!userWithOTP || !userWithOTP.otp) {
        return res.status(400).json({
          message: 'OTP expired or invalid. Please request a new OTP.'
        })
      }

      // Check expiry
      if (userWithOTP.otpExpiry && new Date() > userWithOTP.otpExpiry) {
        // Clear expired OTP
        await User.updateOne({ emailId }, { $unset: { otp: '', otpExpiry: '' } })
        return res.status(400).json({
          message: 'OTP has expired. Please request a new one.'
        })
      }

      storedOTP = userWithOTP.otp
    }

    if (storedOTP !== otp.toString().trim()) {
      return res.status(400).json({
        message: 'Invalid OTP. Please check and try again.'
      })
    }

    console.log(`✅ OTP verified via ${otpSource} for ${emailId}`)

    // Mark user as verified and clear OTP fields from MongoDB
    const user = await User.findOneAndUpdate(
      { emailId },
      { isVerified: true, $unset: { otp: '', otpExpiry: '' } },
      { new: true }
    )

    if (!user) {
      return res.status(404).json({
        message: 'User not found'
      })
    }

    // Clean up Redis cache too (non-critical)
    try {
      await redisClient.del(`otp:${emailId}`)
    } catch (redisErr) {
      console.warn('⚠️  Redis OTP cleanup failed (non-fatal):', redisErr.message)
    }

    // Generate token
    const token = jwt.sign(
      { _id: user._id, emailId: user.emailId, role: user.role },
      process.env.JWT_KEY,
      { expiresIn: 60 * 60 }
    )

    const reply = {
      firstName: user.firstName,
      emailId: user.emailId,
      _id: user._id,
      role: user.role,
      isVerified: user.isVerified
    }

    // Configure cookie for production cross-domain
    const cookieOptions = {
      maxAge: 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    }

    res.cookie('token', token, cookieOptions)
    res.status(200).json({
      user: reply,
      message: 'Email verified successfully'
    })
  } catch (err) {
    console.error('OTP verification error:', err)
    res.status(500).json({
      message: 'Failed to verify OTP'
    })
  }
}

const resendOTP = async (req, res) => {
  try {
    const { emailId } = req.body

    if (!emailId) {
      return res.status(400).json({
        message: 'Email is required'
      })
    }

    // Check if user exists
    const user = await User.findOne({ emailId })

    if (!user) {
      return res.status(404).json({
        message: 'User not found'
      })
    }

    if (user.isVerified) {
      return res.status(400).json({
        message: 'Email already verified'
      })
    }

    // Generate new OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    // Save OTP to MongoDB (primary, reliable)
    await User.updateOne({ emailId }, { otp, otpExpiry })

    // Also cache in Redis (secondary, non-critical)
    try {
      await redisClient.setEx(`otp:${emailId}`, 600, otp)
    } catch (redisErr) {
      console.warn('⚠️  Redis OTP cache failed on resend (non-fatal):', redisErr.message)
    }

    // Send OTP email
    await emailService.sendOTP(emailId, otp, user.firstName)

    res.status(200).json({
      message: 'OTP sent successfully'
    })
  } catch (err) {
    console.error('Resend OTP error:', err)
    res.status(500).json({
      message: 'Failed to resend OTP'
    })
  }
}

module.exports = { register, login, logout, adminRegister, deleteProfile, verifyOTP, resendOTP }
