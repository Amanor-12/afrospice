const { Schema, model, models } = require("mongoose");
const { requiredDateField } = require("./dateFields");

const customerCommunicationLogSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    customerId: { type: Number, required: true, index: true },
    channel: { type: String, required: true, trim: true, index: true },
    status: { type: String, required: true, default: "queued", trim: true, index: true },
    templateKey: { type: String, required: true, default: "manual", trim: true, index: true },
    subject: { type: String, default: "", trim: true },
    recipient: { type: String, default: "", trim: true, index: true },
    provider: { type: String, default: "", trim: true },
    providerMessageId: { type: String, default: "", trim: true },
    contentPreview: { type: String, default: "", trim: true },
    errorMessage: { type: String, default: "", trim: true },
    triggeredByUserId: { type: Number, default: null, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    createdAt: requiredDateField({ index: true }),
  },
  {
    versionKey: false,
  }
);

module.exports =
  models.CustomerCommunicationLog ||
  model("CustomerCommunicationLog", customerCommunicationLogSchema);
