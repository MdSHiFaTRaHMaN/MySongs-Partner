import mongoose from "mongoose";

const videoPackageSchema = new mongoose.Schema({
  id: { type: String, required: true },
  title: { type: String, required: true },
  price: { type: String, required: true },
  rushPrice: { type: String, default: "" },
  tagline: { type: String },
  features: [{ type: String }],
  image: { type: String },
  shopifyProductId: { type: String },
  shopifyVariantId: { type: String },
  shopifyRushVariantId: { type: String },
  compareAtPrice: { type: String },
  rushCompareAtPrice: { type: String }
});

const videoOptionSchema = new mongoose.Schema(
  {
    packages: [videoPackageSchema],
    rushOrderTitle: { type: String, default: "Rush My Video Order" },
    rushOrderDescription: { type: String, default: "Video ready in under 2 hours" },
    step1Title: { type: String, default: "Step 1: Upload your audio track" },
    step1Subtitle: { type: String, default: "Upload your custom song or any audio file you want in the music video." },
    step2Title: { type: String, default: "Step 2: Upload photos and video clips" },
    step2Subtitle: { type: String, default: "Add your favorite pictures and short video clips to make your music video unforgettable." },
    step3Title: { type: String, default: "Step 3: Select your package" },
    step3Subtitle: { type: String, default: "Choose your music video production package and proceed to checkout." }
  },
  { timestamps: true }
);

if (mongoose.models.VideoOption) {
  delete mongoose.models.VideoOption;
}

const VideoOption = mongoose.models.VideoOption || mongoose.model("VideoOption", videoOptionSchema);

export default VideoOption;
