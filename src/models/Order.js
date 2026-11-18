import mongoose from "mongoose";

const TrackSchema = new mongoose.Schema({
  id: String,
  title: String,
  audioUrl: String,
  streamAudioUrl: String,
  imageUrl: String,
  duration: Number,
  lyrics: String,
});

const CustomFileSchema = new mongoose.Schema({
  name: { type: String, default: "" },
  url: { type: String, default: "" },
  key: { type: String, default: "" },
  size: { type: Number, default: 0 },
  mimeType: { type: String, default: "" },
});

const RevisionSchema = new mongoose.Schema({
  version: { type: Number, required: true },
  title: { type: String, default: "" },
  audioUrl: { type: String, default: "" },
  streamAudioUrl: { type: String, default: "" },
  secondaryAudioUrl: { type: String, default: "" },
  secondaryStreamAudioUrl: { type: String, default: "" },
  selectedTrackIds: [{ type: String }],
  tracks: [TrackSchema],
  lyrics: { type: String, default: "" },
  videoUrl: { type: String, default: "" },
  customFiles: [CustomFileSchema],
  note: { type: String, default: "" },
  updatedBy: { type: String, default: "Admin" },
  createdAt: { type: Date, default: Date.now },
});

const RecipientSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    pronunciationMode: { type: String, default: "Original" },
    pronunciation: { type: String, default: "" },
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      index: true,
    },
    taskId: {
      type: String,
      required: true,
      index: true, // Used to match with Shopify later
    },
    musicId: {
      type: String,
      index: true,
      unique: true,
      sparse: true, // Public-facing opaque ID exposed in the cart line item.
      // Never expose taskId itself to the customer/browser — use this to
      // look up the real taskId server-side (e.g. for admin/support tools).
    },
    occasion: String,
    forWho: String,
    recipientName: String,
    recipients: [RecipientSchema],
    storyText: { type: String, default: "" },
    creationMethod: { type: String, default: "write_for_us" },
    ownLyrics: { type: String, default: "" },
    generatedLyrics: { type: String, default: "" },
    formData: { type: mongoose.Schema.Types.Mixed, default: {} },
    genre: String,
    voice: String,
    mood: String,
    language: String,
    lyrics: String,
    musicTracks: [TrackSchema],
    selectedDemo: String, // ID of the track they favorited
    selectedPackage: String,
    orderNotes: String,
    shopifyProductId: {
      type: String,
      index: true, // The Shopify product this order/song was generated against
    },
    shopifyVariantId: String, // The variant added to the Shopify cart
    shopifyOrderId: {
      type: String,
      index: true, // To track and fulfill specific orders
    },
    shopifyOrderNumber: {
      type: String,
      index: true, // e.g. #215859
    },
    deliveryEmailSent: {
      type: Boolean,
      default: false,
    },
    publishLinks: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    publishStatus: {
      type: String, // "pending", "in_progress", "delivered"
      default: "pending",
      index: true,
    },
    uploadedToSpotifyAt: {
      type: Date,
      default: null,
    },
    emailDeliveryFailed: {
      type: Boolean,
      default: false,
    },
    emailDeliveryError: {
      type: String,
      default: "",
    },
    deliveredVersion: {
      type: Number,
      default: 0,
    },
    resumeEmailSent: {
      type: Boolean,
      default: false,
    },
    resumeBaseUrl: String,
    lastPolledAt: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      default: "created", // Initial state when generated but not added to cart
    },
    generationError: {
      type: String,
      default: "",
    },
    currentVersion: {
      type: Number,
      default: 1,
    },
    revisions: [RevisionSchema],
    s3CleanedUp: {
      type: Boolean,
      default: false,
    },
    s3CleanedUpAt: {
      type: Date,
      default: null,
    },
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

OrderSchema.index({ isDeleted: 1, deletedAt: -1 });
OrderSchema.index({ isDeleted: 1, createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ email: 1, createdAt: -1 });
OrderSchema.index({ shopifyOrderId: 1, shopifyOrderNumber: 1 });

// Hot-reload safe export
if (process.env.NODE_ENV !== "production" && mongoose.models.Order) {
  delete mongoose.models.Order;
}

const Order = mongoose.models.Order || mongoose.model("Order", OrderSchema);

export default Order;