const { Schema, model, models } = require("mongoose");
const { optionalDateField, requiredDateField } = require("./dateFields");

const staffOrderLineStateSchema = new Schema(
  {
    productId: { type: Number, required: true },
    picked: { type: Boolean, required: true, default: false },
    pickedQty: { type: Number, required: true, default: 0 },
    pickedAt: optionalDateField(),
    pickedByUserId: { type: Number, default: null },
    pickedByName: { type: String, default: "", trim: true },
  },
  {
    _id: false,
  }
);

const staffOrderStatusEventSchema = new Schema(
  {
    fromStatus: { type: String, default: "", trim: true },
    toStatus: { type: String, required: true, trim: true },
    note: { type: String, default: "", trim: true },
    actorUserId: { type: Number, default: null },
    actorName: { type: String, default: "", trim: true },
    createdAt: requiredDateField(),
  },
  {
    _id: false,
  }
);

const staffOrderWorkStateSchema = new Schema(
  {
    saleId: { type: String, required: true, unique: true, trim: true, index: true },
    fulfillmentStatus: {
      type: String,
      required: true,
      default: "New",
      trim: true,
      index: true,
    },
    priority: { type: String, required: true, default: "Normal", trim: true, index: true },
    promiseTime: requiredDateField({ index: true }),
    assignedTo: { type: String, default: "Unassigned", trim: true },
    assignedUserId: { type: Number, default: null, index: true },
    staffNote: { type: String, default: "", trim: true },
    flagReason: { type: String, default: "", trim: true },
    lineStates: { type: [staffOrderLineStateSchema], required: true, default: [] },
    statusHistory: { type: [staffOrderStatusEventSchema], required: true, default: [] },
    createdAt: requiredDateField(),
    updatedAt: requiredDateField({ index: true }),
  },
  {
    versionKey: false,
  }
);

module.exports =
  models.StaffOrderWorkState || model("StaffOrderWorkState", staffOrderWorkStateSchema);
