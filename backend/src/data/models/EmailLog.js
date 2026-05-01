const { Schema, model, models } = require("mongoose");
const { requiredDateField } = require("./dateFields");

const emailLogSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    userId: { type: Number, default: null, index: true },
    recipientEmail: { type: String, required: true, trim: true, index: true },
    status: { type: String, required: true, default: "failed", trim: true, index: true },
    errorMessage: { type: String, required: false, default: "", trim: true },
    type: { type: String, required: true, default: "daily-summary", trim: true, index: true },
    attempt: { type: Number, required: true, default: 1 },
    provider: { type: String, required: true, default: "smtp", trim: true },
    messageId: { type: String, required: false, default: "", trim: true },
    subject: { type: String, required: true, default: "", trim: true },
    digestDate: { type: String, required: true, default: "", trim: true },
    trigger: { type: String, required: true, default: "manual", trim: true },
    timestamp: requiredDateField({ index: true }),
  },
  {
    versionKey: false,
  }
);

module.exports = models.EmailLog || model("EmailLog", emailLogSchema);
