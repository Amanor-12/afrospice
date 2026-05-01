const { Schema, model, models } = require("mongoose");
const { optionalDateField, requiredDateField } = require("./dateFields");

const userPasskeySchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    userId: { type: Number, required: true, index: true },
    staffId: { type: String, required: true, trim: true, index: true },
    label: { type: String, required: true, default: "Platform Authenticator", trim: true },
    credentialId: { type: String, required: true, unique: true, trim: true, index: true },
    publicKey: { type: String, required: true, trim: true },
    counter: { type: Number, required: true, default: 0 },
    transports: { type: [String], required: true, default: [] },
    deviceType: { type: String, required: true, default: "singleDevice", trim: true },
    backedUp: { type: Boolean, required: true, default: false },
    createdAt: requiredDateField(),
    updatedAt: requiredDateField(),
    lastUsedAt: optionalDateField({ index: true }),
  },
  {
    versionKey: false,
  }
);

module.exports = models.UserPasskey || model("UserPasskey", userPasskeySchema);
