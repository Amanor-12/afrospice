const { Schema, model, models } = require("mongoose");
const { requiredDateField, optionalDateField } = require("./dateFields");

const notificationReceiptSchema = new Schema(
  {
    userId: { type: Number, required: true, index: true },
    notificationId: { type: String, required: true, trim: true, index: true },
    signature: { type: String, required: true, trim: true },
    acknowledgedAt: optionalDateField(),
    createdAt: requiredDateField(),
    updatedAt: requiredDateField(),
  },
  {
    versionKey: false,
  }
);

notificationReceiptSchema.index({ userId: 1, notificationId: 1 }, { unique: true });

module.exports = models.NotificationReceipt || model("NotificationReceipt", notificationReceiptSchema);
