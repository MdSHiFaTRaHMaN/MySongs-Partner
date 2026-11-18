import mongoose from "mongoose";

const RoleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    description: {
      type: String,
      default: "",
    },
    permissions: {
      type: [String],
      default: [], // List of route paths allowed, e.g. ["/", "/orders", "/customers", "/ordered-musics", "/all-musics"]
    },
  },
  { timestamps: true }
);

const Role = mongoose.models.Role || mongoose.model("Role", RoleSchema);

export default Role;
