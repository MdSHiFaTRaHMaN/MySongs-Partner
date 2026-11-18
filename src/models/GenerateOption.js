import mongoose from "mongoose";

const packageSchema = new mongoose.Schema({
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

const upsellSchema = new mongoose.Schema({
  id: { type: String, required: true },
  title: { type: String, required: true },
  subtext: { type: String, default: "" },
  price: { type: String, default: "" },
  type: { type: String, enum: ["rush", "product"], default: "product" },
  shopifyProductId: { type: String, default: "" },
  shopifyVariantId: { type: String, default: "" },
  enabled: { type: Boolean, default: true },
  defaultSelected: { type: Boolean, default: false },
  order: { type: Number, default: 0 },
});

const generateOptionSchema = new mongoose.Schema(
  {
    occasions: [{ type: String }],
    genres: [{ type: String }],
    voices: [{ type: String }],
    moods: [{ type: String }],
    languages: [{ type: String }],
    packages: [packageSchema],
    upsells: [upsellSchema],
    rushOrderTitle: { type: String, default: "Rush My Order" },
    rushOrderDescription: { type: String, default: "Order delivered in 60 minutes" }
  },
  { timestamps: true }
);

// We will only store one document for options.
const GenerateOption = mongoose.models.GenerateOption || mongoose.model("GenerateOption", generateOptionSchema);

export default GenerateOption;