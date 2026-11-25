from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class CaptureFrame(ApiModel):
    content_base64: str = Field(alias="contentBase64", min_length=100, max_length=7_000_000)
    mime_type: Literal["image/jpeg", "image/png"] = Field(alias="mimeType")

    @field_validator("content_base64")
    @classmethod
    def reject_data_url(cls, value: str) -> str:
        if value.startswith("data:"):
            raise ValueError("contentBase64 no debe incluir prefijo data URL")
        return value


class EvidenceRequest(ApiModel):
    tenant_ref: str = Field(alias="tenantRef", min_length=1, max_length=191)
    subject_ref: str = Field(alias="subjectRef", min_length=1, max_length=191)
    challenge_ref: str = Field(alias="challengeRef", min_length=8, max_length=191)
    liveness_action: Literal["TURN_LEFT", "TURN_RIGHT"] = Field(alias="livenessAction")
    require_liveness: bool = Field(alias="requireLiveness", default=True)
    captures: list[CaptureFrame] = Field(min_length=1, max_length=8)


class EnrollRequest(EvidenceRequest):
    retention_days: int = Field(alias="retentionDays", ge=1, le=3650)


class VerifyRequest(EvidenceRequest):
    template_ref: str = Field(alias="templateRef", min_length=20, max_length=191)


class RevokeRequest(ApiModel):
    tenant_ref: str = Field(alias="tenantRef", min_length=1, max_length=191)
    subject_ref: str = Field(alias="subjectRef", min_length=1, max_length=191)
    template_ref: str = Field(alias="templateRef", min_length=20, max_length=191)


class EnrollResponse(ApiModel):
    template_ref: str = Field(alias="templateRef")
    liveness_passed: bool = Field(alias="livenessPassed")
    provider_status: str = Field(alias="providerStatus")


class VerifyResponse(ApiModel):
    matched: bool
    liveness_passed: bool = Field(alias="livenessPassed")
    score: float | None
    provider_status: str = Field(alias="providerStatus")


class RevokeResponse(ApiModel):
    revoked: bool
    provider_status: str = Field(alias="providerStatus")
