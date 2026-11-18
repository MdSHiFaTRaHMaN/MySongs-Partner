import mongoose from "mongoose";

const AccessRequestSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    userEmail: {
      type: String,
      required: true,
    },
    userName: {
      type: String,
      default: "",
    },
    requestedPath: {
      type: String,
      required: true,
    },
    requestedPathLabel: {
      type: String,
      default: "",
    },
    reason: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
  },
  { timestamps: true }
);

const AccessRequest =
  mongoose.models.AccessRequest ||
  mongoose.model("AccessRequest", AccessRequestSchema);

export default AccessRequest;
