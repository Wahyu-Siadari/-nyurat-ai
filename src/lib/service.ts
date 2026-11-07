import { createApiService } from "./api-service.ts";
import { requestPhotoAudit } from "./photo-audit.ts";

export const nyuratService = {
  ...createApiService(),
  auditPhoto: requestPhotoAudit,
};
