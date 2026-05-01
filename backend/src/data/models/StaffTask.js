const { Schema, model, models } = require("mongoose");
const { optionalDateField, requiredDateField } = require("./dateFields");

const staffTaskEventSchema = new Schema(
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

const staffTaskSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, trim: true, index: true },
    title: { type: String, required: true, trim: true },
    area: { type: String, required: true, trim: true, index: true },
    owner: { type: String, default: "Unassigned", trim: true },
    ownerUserId: { type: Number, default: null, index: true },
    dueAt: requiredDateField({ index: true }),
    priority: { type: String, required: true, default: "Normal", trim: true, index: true },
    status: { type: String, required: true, default: "Open", trim: true, index: true },
    source: { type: String, default: "system", trim: true },
    completedAt: optionalDateField(),
    statusHistory: { type: [staffTaskEventSchema], required: true, default: [] },
    createdAt: requiredDateField(),
    updatedAt: requiredDateField({ index: true }),
  },
  {
    versionKey: false,
  }
);

module.exports = models.StaffTask || model("StaffTask", staffTaskSchema);
