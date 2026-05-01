const { Schema, model, models } = require("mongoose");
const { requiredDateField } = require("./dateFields");

const userAccessEventSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    userId: { type: Number, default: null, index: true },
    staffId: { type: String, required: true, default: "", trim: true, index: true },
    fullName: { type: String, required: true, default: "", trim: true },
    sessionId: { type: String, default: "", trim: true, index: true },
    eventType: { type: String, required: true, default: "", trim: true, index: true },
    title: { type: String, required: true, default: "", trim: true },
    message: { type: String, required: true, default: "", trim: true },
    actorName: { type: String, required: true, default: "", trim: true },
    sourceIp: { type: String, default: "", trim: true },
    userAgent: { type: String, default: "", trim: true },
    severity: { type: String, required: true, default: "info", trim: true, index: true },
    tags: { type: [String], default: [] },
    createdAt: requiredDateField({ index: true }),
  },
  {
    versionKey: false,
  }
);

module.exports = models.UserAccessEvent || model("UserAccessEvent", userAccessEventSchema);
