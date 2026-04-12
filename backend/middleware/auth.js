const jwt = require("jsonwebtoken");
const { supabase } = require("../config/database");

const JWT_SECRET = process.env.JWT_SECRET;

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Token không tồn tại",
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    const { data: user, error } = await supabase
      .from("Users")
      .select("UserID, Username")
      .eq("UserID", decoded.userId)
      .single();

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: "User không tồn tại",
      });
    }

    req.user = {
      UserID: decoded.userId,
      username: decoded.username,
    };
    req.userId = decoded.userId;

    next();
  } catch (err) {
    console.error("Token verification error:", err);
    return res.status(403).json({
      success: false,
      message: "Token không hợp lệ hoặc đã hết hạn",
    });
  }
};

module.exports = { authenticateToken };
