const express = require("express");
const router = express.Router();

router.get("/public", (req, res) => {
  res.json({
    success: true,
    data: {
      supabaseUrl: process.env.SUPABASE_URL || "",
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
    },
  });
});

module.exports = router;
