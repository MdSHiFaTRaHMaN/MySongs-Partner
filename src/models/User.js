import mongoose from "mongoose";

const SessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true },
    device: { type: String, default: "Desktop" },
    browser: { type: String, default: "Chrome" },
    os: { type: String, default: "Windows" },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    lastActive: { type: Date, default: Date.now },
  },
  { _id: true, timestamps: true }
);

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      default: "staff",
    },
    customRole: {
      type: String,
      default: "",
    },
    permissions: {
      type: [String],
      default: [], // Route paths user is allowed to access
    },
    avatar: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["active", "inactive", "suspended"],
      default: "active",
    },
    phone: {
      type: String,
      default: "",
    },
    designation: {
      type: String,
      default: "",
    },
    lastLogin: {
      type: Date,
    },
    bio: {
      type: String,
      default: "",
    },
    address: {
      country: { type: String, default: "" },
      cityState: { type: String, default: "" },
      postalCode: { type: String, default: "" },
      taxId: { type: String, default: "" },
    },
    socialLinks: {
      facebook: { type: String, default: "" },
      x: { type: String, default: "" },
      linkedin: { type: String, default: "" },
      instagram: { type: String, default: "" },
    },
    twoFactorSecret: {
      type: String,
      default: "",
    },
    isTwoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    enableVideoTool: {
      type: Boolean,
      default: true,
    },
    passwordChangedAt: {
      type: Date,
    },
    sessions: {
      type: [SessionSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

if (mongoose.models.User) {
  delete mongoose.models.User;
}

const User = mongoose.models.User || mongoose.model("User", UserSchema);

export default User;
