import mongoose from "mongoose";

const NotificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { 
      type: String, 
      enum: [
        "shopify_order",
        "music_generated",
        "music_started",
        "added_to_cart",
        "revision_added",
        "publish_delivered",
        "music_delivered",
        "video_order",
        "order_fulfilled",
        "other"
      ], 
      default: "other" 
    },
    isRead: { type: Boolean, default: false },
    link: { type: String, default: "" },
  },
  { timestamps: true }
);

NotificationSchema.index({ createdAt: -1 });

if (mongoose.models.Notification) {
  delete mongoose.models.Notification;
}

const Notification = mongoose.model("Notification", NotificationSchema);
export default Notification;
