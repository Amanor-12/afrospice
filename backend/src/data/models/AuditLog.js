const { Schema, model, models } = require("mongoose");
const { requiredDateField } = require("./dateFields");

const auditRequestSchema = new Schema(
  {
    method: { type: String, default: "", trim: true },
    path: { type: String, default: "", trim: true },
    sourceIp: { type: String, default: "", trim: true },
    userAgent: { type: String, default: "", trim: true },
    sessionId: { type: String, default: "", trim: true },
  },
  {
    _id: false,
  }
);

const auditLogSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    action: { type: String, required: true, trim: true, index: true },
    entityType: { type: String, required: true, trim: true, index: true },
    entityId: { type: String, required: true, trim: true, index: true },
    actorUserId: { type: Number, default: null, index: true },
    actorStaffId: { type: String, required: true, default: "", trim: true },
    actorName: { type: String, required: true, default: "", trim: true },
    requestId: { type: String, default: "", trim: true, index: true },
    request: { type: auditRequestSchema, default: () => ({}) },
    details: { type: Schema.Types.Mixed, required: true, default: {} },
    createdAt: requiredDateField({ index: true }),
  },
  {
    versionKey: false,
  }
);

auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ requestId: 1, createdAt: -1 });

module.exports = models.AuditLog || model("AuditLog", auditLogSchema);
