import mongoose from "mongoose";

const SettingsSchema = new mongoose.Schema(
  {
    shopifySecretId: { type: String, default: "" },
    shopifyClientId: { type: String, default: "" },
    shopifyAdminApiKey: { type: String, default: "" },
    shopifyTokenExpiresAt: { type: Number, default: 0 },
    shopUrl1: { type: String, default: "" },
    shopUrl2: { type: String, default: "" },
    sunoApiKey: { type: String, default: "" },
    sunoModel: { type: String, default: "V3_5" },
    activeAiProvider: { type: String, enum: ["suno", "mureka"], default: "suno" },
    murekaApiKey: { type: String, default: "" },
    murekaModel: { type: String, default: "mureka-9.5" },
    notificationEmail: { type: String, default: "" },
    contactPhone: { type: String, default: "" },
    klaviyoApiKey: { type: String, default: "" },
    monthlyTarget: { type: Number, default: 20000 },
    
    // Music Publish Orders Filtering
    publishProductKeywords: {
      type: [String],
      default: ["Music on Spotify", "Spotify & Apple Music", "Song on Spotify & Apple Music", "Spotify", "Apple Music", "Muziek op Spotify", "Song on Spotify"],
    },
    publishProductIds: {
      type: [String],
      default: [],
    },
    
    // Limits & Security
    previewDurationSeconds: { type: Number, default: 45 },
    rateLimitPerMinute: { type: Number, default: 0 },
    rateLimitPerHour: { type: Number, default: 0 },
    rateLimitPerDay: { type: Number, default: 10 },
    rateLimitPerMonth: { type: Number, default: 0 },
    autoBlockEnabled: { type: Boolean, default: false },
    autoBlockGenerationCount: { type: Number, default: 5 },
    autoBlockRequiredPurchases: { type: Number, default: 0 },
    tableItemsPerPage: { type: Number, default: 50 },
    trashBinRetentionDays: { type: Number, default: 30 },

    // Automated Storage & Cleanup Engine
    autoCleanupEnabled: { type: Boolean, default: false },
    autoCleanupTime: { type: String, default: "03:00" },
    autoCleanupRules: {
      type: [
        {
          id: { type: String },
          name: { type: String, default: "" },
          targetType: {
            type: String,
            enum: ["unpaid_music", "paid_music", "unpaid_video", "paid_video", "trash_bin"],
            default: "unpaid_music",
          },
          daysOlderThan: { type: Number, default: 60 },
          action: {
            type: String,
            enum: ["move_to_trash", "permanent_purge"],
            default: "move_to_trash",
          },
          enabled: { type: Boolean, default: true },
        },
      ],
      default: [
        {
          id: "rule_unpaid_music",
          name: "Unpaid / Abandoned Music Drafts",
          targetType: "unpaid_music",
          daysOlderThan: 60,
          action: "move_to_trash",
          enabled: true,
        },
        {
          id: "rule_unpaid_video",
          name: "Unpaid / Abandoned Video Drafts",
          targetType: "unpaid_video",
          daysOlderThan: 60,
          action: "move_to_trash",
          enabled: true,
        },
        {
          id: "rule_trash_purge",
          name: "Trash Bin Expired Items",
          targetType: "trash_bin",
          daysOlderThan: 30,
          action: "permanent_purge",
          enabled: true,
        },
      ],
    },
  },
  { timestamps: true }
);

if (mongoose.models.Settings) {
  delete mongoose.models.Settings;
}

const Settings = mongoose.model("Settings", SettingsSchema);
export default Settings;
