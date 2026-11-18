import mongoose from "mongoose";

const MediaFileSchema = new mongoose.Schema({
  key: { type: String, required: true },
  url: { type: String, default: "" },
  name: { type: String, default: "" },
  size: { type: Number, default: 0 },
  type: { type: String, enum: ["image", "video", "audio", "other"], default: "image" },
  mimeType: { type: String, default: "" },
  order: { type: Number, default: 0 },
});

const VideoRevisionSchema = new mongoose.Schema({
  version: { type: Number, required: true },
  title: { type: String, default: "" },
  videoUrl: { type: String, default: "" },
  videoKey: { type: String, default: "" },
  audioUrl: { type: String, default: "" },
  audioKey: { type: String, default: "" },
  lyrics: { type: String, default: "" },
  customFiles: [
    {
      name: { type: String, default: "" },
      url: { type: String, default: "" },
      key: { type: String, default: "" },
      size: { type: Number, default: 0 },
    }
  ],
  note: { type: String, default: "" },
  updatedBy: { type: String, default: "Admin" },
  createdAt: { type: Date, default: Date.now },
});

const VideoOrderSchema = new mongoose.Schema(
  {
    videoId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      index: true,
    },
    customerName: {
      type: String,
      default: "",
    },
    shopifyOrderId: {
      type: String,
      index: true,
      default: "",
    },
    shopifyOrderNumber: {
      type: String,
      default: "",
    },
    shopifyProductId: {
      type: String,
      default: "",
    },
    shopifyVariantId: {
      type: String,
      default: "",
    },
    audioFile: {
      key: { type: String, default: "" },
      url: { type: String, default: "" },
      name: { type: String, default: "" },
      size: { type: Number, default: 0 },
    },
    mediaFiles: [MediaFileSchema],
    selectedPackage: {
      type: String,
      default: "Music Video",
    },
    videoFormat: {
      type: String,
      enum: ["9:16", "16:9"],
      default: "9:16",
    },
    packagePrice: {
      type: Number,
      default: 0,
    },
    currency: {
      type: String,
      default: "USD",
    },
    orderNotes: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["created", "in_cart", "pending", "paid", "in_production", "ready", "delivering", "fulfilled", "cancelled"],
      default: "created",
      index: true,
    },
    finalVideoKey: {
      type: String,
      default: "",
    },
    finalVideoUrl: {
      type: String,
      default: "",
    },
    assignedEditor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    // One-Time Secure Upload Portal Tokens
    uploadToken: {
      type: String,
      index: true,
      sparse: true,
    },
    uploadTokenStatus: {
      type: String,
      enum: ["active", "consumed", "expired"],
      default: "active",
      index: true,
    },
    tokenHistory: [
      {
        token: { type: String, required: true },
        status: { type: String, enum: ["active", "consumed", "expired"], default: "consumed" },
        createdAt: { type: Date, default: Date.now },
        consumedAt: { type: Date },
      },
    ],
    lastSubmittedAt: {
      type: Date,
      default: null,
    },
    originalMusicOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
    },
    // Allows customer to regenerate / change music tracks on their upload portal
    allowMusicRegeneration: {
      type: Boolean,
      default: true,
    },
    deliveryEmailSent: {
      type: Boolean,
      default: false,
    },
    deliveredVersion: {
      type: Number,
      default: 0,
    },
    deliveredAt: {
      type: Date,
    },
    fulfillmentError: {
      type: String,
      default: "",
    },
    currentVersion: {
      type: Number,
      default: 1,
    },
    revisions: [VideoRevisionSchema],
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
    deletedBy: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

VideoOrderSchema.index({ isDeleted: 1, deletedAt: -1 });

// Only clear model cache in development (hot reload). In production (PM2/VPS) this is unnecessary.
if (process.env.NODE_ENV !== "production" && mongoose.models.VideoOrder) {
  delete mongoose.models.VideoOrder;
}

const VideoOrder = mongoose.models.VideoOrder || mongoose.model("VideoOrder", VideoOrderSchema);

export default VideoOrder;
