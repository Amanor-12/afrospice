const { Schema, model, models } = require("mongoose");
const { requiredDateField } = require("./dateFields");

const supplierSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    name: { type: String, required: true, unique: true, trim: true },
    contactName: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
    accountCode: { type: String, default: "", trim: true },
    preferredCategory: { type: String, default: "", trim: true },
    paymentTerms: { type: String, default: "", trim: true },
    reviewCadence: { type: String, default: "", trim: true },
    shipmentCadence: { type: String, default: "", trim: true },
    orderingCutoffTime: { type: String, default: "", trim: true },
    minimumOrderValue: { type: Number, default: null, min: 0 },
    minimumOrderUnits: { type: Number, default: null, min: 0 },
    logisticsMode: { type: String, default: "", trim: true },
    dispatchRegion: { type: String, default: "", trim: true },
    receivingWindow: { type: String, default: "", trim: true },
    receivingDock: { type: String, default: "", trim: true },
    complianceTier: { type: String, default: "", trim: true },
    escalationContact: { type: String, default: "", trim: true },
    portalReference: { type: String, default: "", trim: true },
    trackingUrl: { type: String, default: "", trim: true },
    leadTimeDays: { type: Number, default: null, min: 0 },
    serviceLevelTarget: { type: Number, default: null, min: 0, max: 100 },
    isPreferred: { type: Boolean, required: true, default: false, index: true },
    notes: { type: String, default: "", trim: true },
    isActive: { type: Boolean, required: true, default: true, index: true },
    createdAt: requiredDateField(),
    updatedAt: requiredDateField(),
  },
  {
    versionKey: false,
  }
);

module.exports = models.Supplier || model("Supplier", supplierSchema);
