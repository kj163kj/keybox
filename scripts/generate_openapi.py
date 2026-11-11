"""Generate the complete API contract using only Python's standard library.

Run: python scripts/generate_openapi.py [--check]
No secrets, certificate samples, or private key material belong in this file.
"""
import json
import pathlib
import sys

STATUS = ["valid", "invalid", "revoked", "expired", "untrusted_root", "chain_invalid", "indeterminate"]
POLICY = ["inherit", "allowed", "denied"]
S = {"type": "string"}
B = {"type": "boolean"}
I = {"type": "integer", "format": "int64"}
DT = {"type": "string", "format": "date-time"}
ID = {"type": "string", "pattern": "^[0-9a-f]{32}$"}
SHA = {"type": "string", "pattern": "^[0-9a-f]{64}$"}
CRL_STATUS = {"type": "string", "enum": ["not_revoked", "revoked", "unknown"]}


def ref(name):
    return {"$ref": "#/components/schemas/" + name}


def array(item):
    return {"type": "array", "items": item}


def obj(properties, required=None):
    fields = list(properties) if required is None else required
    return {"type": "object", "properties": properties,
            **({"required": fields} if fields else {}),
            "additionalProperties": False}


def nullable(schema):
    return {**schema, "nullable": True}


def envelope(data, success=True):
    return obj({"code": {"type": "integer", **({"enum": [0]} if success else {"minimum": 40001})},
                "message": S, "data": data, "request_id": ID})


def page(item, extra=None):
    return obj({"items": array(item), "page": I, "page_size": I, "total": I, **(extra or {})})


schemas = {
    "Status": {"type": "string", "enum": STATUS},
    "DownloadPolicy": {"type": "string", "enum": POLICY},
    "Problem": obj({"code": S, "chain": {"type": "integer", "minimum": 1},
                    "position": {"type": "integer", "minimum": 0}}, ["code"]),
    "Certificate": obj({
        "subject": S, "issuer": S, "serial_number": {"type": "string", "pattern": "^[0-9a-f]+$"},
        "fingerprint_sha256": SHA, "not_before": DT, "not_after": DT,
        "position": {"type": "integer", "minimum": 0}, "is_root": B, "root_trusted": B,
        "chain_signature_valid": B, "time_valid": B, "crl_status": CRL_STATUS,
        "certificate_status": ref("Status")}),
    "Chain": obj({"index": {"type": "integer", "minimum": 1},
                  "algorithm": {"type": "string", "enum": ["rsa", "ecdsa"]},
                  "chain_status": ref("Status"), "private_key_valid": B,
                  "certificates": array(ref("Certificate"))}),
}
validation_properties = {
    "overall_status": ref("Status"), "file_sha256": SHA, "chains": array(ref("Chain")),
    "errors": array(ref("Problem")), "root_set_version": S, "crl_version": S,
    "crl_fetched_at": nullable(DT), "crl_expires_at": nullable(DT), "crl_usable": B, "validated_at": DT,
}
summary_properties = {
    "id": ID, "file_sha256": SHA, "overall_status": ref("Status"),
    "last_validation_status": ref("Status"), "created_at": DT, "last_validated_at": DT,
    "guest_downloadable_effective": B,
}
detail_properties = {
    "id": ID, **validation_properties, "created_at": DT, "status_checked_at": DT,
    "guest_download_enabled": B, "guest_download_policy": ref("DownloadPolicy"),
    "guest_downloadable_effective": B,
}
visibility = {"type": "string", "enum": ["public", "hidden"]}
note = {"type": "string", "maxLength": 2000, "description": "Maximum 2000 UTF-8 bytes."}
schemas.update({
    "Validation": obj(validation_properties),
    "KeyboxSummary": obj(summary_properties),
    "AdminKeyboxSummary": obj({**summary_properties, "visibility": visibility,
                              "guest_download_policy": ref("DownloadPolicy")}),
    "KeyboxDetail": obj(detail_properties),
    "AdminKeyboxDetail": obj({**detail_properties, "visibility": visibility, "admin_note": note}),
    "KeyboxCreated": obj({"id": ID, "overall_status": {"type": "string", "enum": ["valid"]},
                          "created_at": DT}),
    "StatusResult": obj({"id": ID, "validation": ref("Validation"), "status_checked_at": DT}),
    "CertificateMatch": obj({"keybox_id": ID, "chain_index": I, "certificate": ref("Certificate")}),
    "CertificateQuery": obj({"serial_number": S, "fingerprint_sha256": S,
                             "crl_status": CRL_STATUS, "certificate_status": ref("Status")}),
    "LoginInput": obj({"username": {"type": "string", "minLength": 1, "maxLength": 128},
                       "password": {"type": "string", "format": "password", "maxLength": 72}}),
    "LoginResult": obj({"admin": obj({"id": ID, "username": S}), "csrf_token": SHA, "expires_at": DT}),
    "AdminSetupStatus": obj({"initialized": B, "setup_available": B}),
    "AdminSetupInput": obj({
        "setup_token": {"type": "string", "format": "password", "writeOnly": True,
                        "minLength": 32, "maxLength": 256,
                        "description": "Deployment-only secret. Never store in browser storage or URLs."},
        "username": {"type": "string", "minLength": 1, "maxLength": 128,
                     "description": "Trimmed username, 1-128 UTF-8 bytes; no control characters."},
        "password": {"type": "string", "format": "password", "writeOnly": True, "maxLength": 72,
                     "description": "16-72 UTF-8 bytes, not characters. Never trimmed or truncated."},
    }),
    "AdminSetupResult": obj({"initialized": {"type": "boolean", "enum": [True]},
                             "admin": obj({"id": ID, "username": S})}),
    "Me": obj({"id": ID, "username": S, "csrf_token": SHA, "expires_at": DT}),
    "KeyboxPatch": {**obj({"visibility": visibility, "admin_note": note,
                          "guest_download_policy": ref("DownloadPolicy")}, []), "minProperties": 1},
    "GuestDownloadSetting": obj({"enabled": B}),
    "ValidationRun": obj({"id": ID, "keybox_id": ID, "input_sha256": SHA,
                          "overall_status": ref("Status"), "root_set_version": S, "crl_version": S,
                          "created_at": DT, "validation": ref("Validation")}),
    "AuditLog": obj({"id": ID, "admin_id": nullable(ID), "action": S, "target_type": S,
                     "target_id": nullable(S), "ip_hash": S, "user_agent_hash": S, "result": S,
                     "request_id": ID, "created_at": DT}),
    "DownloadLog": obj({"id": ID, "keybox_id": nullable(ID),
                        "actor_type": {"type": "string", "enum": ["guest", "admin"]},
                        "admin_id": nullable(ID), "ip_hash": S, "user_agent_hash": S, "result": S,
                        "request_id": ID, "created_at": DT}),
    "Health": obj({"status": {"type": "string", "enum": ["healthy", "degraded"]},
                   "database": {"type": "string", "enum": ["up", "down"]},
                   "root_set_version": S, "root_count": I,
                   "crl": obj({"version": S, "fetched_at": DT, "expires_at": DT, "expired": B, "usable": B}),
                   "guest_download_enabled": B}),
    "CRLRefresh": obj({"version": S, "fetched_at": DT, "expires_at": DT, "usable": B}),
    "Error": envelope({"nullable": True}, False),
})
for name in ["KeyboxSummary", "AdminKeyboxSummary", "ValidationRun", "AuditLog", "DownloadLog"]:
    schemas[name + "Page"] = page(ref(name))
schemas["CertificatePage"] = page(ref("CertificateMatch"), {
    "query": ref("CertificateQuery"), "status_checked_at": DT})

headers = {
    "X-Request-ID": {"description": "Fresh server-generated request ID.", "schema": ID},
    "Cache-Control": {"description": "Always no-store.", "schema": {"type": "string", "enum": ["no-store"]}},
}
error_codes = {
    "400": [40001], "401": [40101, 40102], "403": [40301, 40302, 40303, 40304], "404": [40401], "405": [40501],
    "408": [40801], "409": [40901, 40902, 40903, 40904], "413": [41301], "415": [41501],
    "422": [42201, 42202], "429": [42901, 42902], "500": [50001], "503": [50301, 50302, 50303],
}
responses = {}
for status, codes in error_codes.items():
    response_headers = dict(headers)
    if status == "429":
        response_headers["Retry-After"] = {
            "description": "Seconds before retry; present on every 429.",
            "schema": {"type": "integer", "minimum": 1}}
    data = ref("Error")
    if status == "422":
        data = envelope(ref("Validation"), False)
    responses["Error" + status] = {
        "description": "Application error codes: " + ", ".join(map(str, codes)),
        "headers": response_headers, "content": {"application/json": {"schema": data}},
        "x-error-codes": codes,
    }

parameters = {
    "ID": {"name": "id", "in": "path", "required": True, "schema": ID},
    "Page": {"name": "page", "in": "query", "schema": {"type": "integer", "default": 1, "minimum": 1, "maximum": 10000}},
    "PageSize": {"name": "page_size", "in": "query", "schema": {"type": "integer", "default": 20, "minimum": 1, "maximum": 100}},
    "Status": {"name": "status", "in": "query", "schema": ref("Status"),
               "description": "Filter projected status; stale historical valid is indeterminate."},
    "Origin": {"name": "Origin", "in": "header", "required": True, "schema": S,
               "description": "Exact configured HTTPS origin; required for admin writes, including login and setup."},
    "Policy": {"name": "guest_download_policy", "in": "query", "schema": ref("DownloadPolicy")},
}


def param(name):
    return {"$ref": "#/components/parameters/" + name}


def body(schema, media="application/json"):
    return {"required": True, "content": {media: {"schema": schema}}}


def success(schema, status="200", binary=False):
    if binary:
        return {"description": "Original XML including private key material; never cache.",
                "headers": {**headers,
                            "Content-Disposition": {"schema": S, "description": "attachment; generated filename"},
                            "X-Content-Type-Options": {"schema": {"type": "string", "enum": ["nosniff"]}},
                            "Surrogate-Control": {"schema": {"type": "string", "enum": ["no-store"]}},
                            "Content-Length": {"schema": I}},
                "content": {"application/xml": {"schema": {"type": "string", "format": "binary"}}}}
    return {"description": "Success", "headers": headers,
            "content": {"application/json": {"schema": envelope(schema)}}}


paths = {}


def operation(path, method, op_id, description, result, *, admin=False, errors=(), params=(),
              request=None, status="200", binary=False, preauth=False):
    method = method.lower()
    all_errors = set(errors) | {"403", "408", "429", "500", "503"}
    if admin:
        all_errors.add("401")
    response_map = {status: success(result, status, binary)}
    response_map.update({e: {"$ref": "#/components/responses/Error" + e} for e in sorted(all_errors)})
    auth = {"AdminSession": []}
    if admin and method != "get":
        auth["CSRFToken"] = []
    parameters_for_op = list(params)
    if "{id}" in path:
        parameters_for_op.insert(0, param("ID"))
    if (preauth or admin) and method != "get":
        parameters_for_op.append(param("Origin"))
    op = {"operationId": op_id, "summary": description, "tags": ["Admin" if admin or preauth else "Public"],
          "security": [auth] if admin else [], "responses": response_map}
    if parameters_for_op:
        op["parameters"] = parameters_for_op
    if request:
        op["requestBody"] = request
    paths.setdefault(path, {})[method] = op
    return op


prefix = "/api/v1"
pages = [param("Page"), param("PageSize")]
file_body = body(obj({"file": {"type": "string", "format": "binary",
                               "description": "Exactly one .xml file, <=1048576 bytes. No compression."}}),
                 "multipart/form-data")
operation(prefix + "/keyboxes/validate", "post", "validateKeybox",
          "Validate without formal persistence; a parsed invalid chain returns 200 with non-valid status.",
          ref("Validation"), request=file_body, errors=["400", "413", "415", "422"])
operation(prefix + "/keyboxes", "post", "uploadKeybox",
          "Fully revalidate and persist only valid input; duplicate cert material is rejected.",
          ref("KeyboxCreated"), request=file_body, status="201", errors=["400", "409", "413", "415", "422"])
operation(prefix + "/keyboxes", "get", "listKeyboxes", "List public, nondeleted keyboxes.",
          ref("KeyboxSummaryPage"), params=pages + [param("Status")], errors=["400"])
operation(prefix + "/keyboxes/{id}", "get", "getKeybox", "Get public metadata and current cached status.",
          ref("KeyboxDetail"), errors=["404"])
operation(prefix + "/keyboxes/{id}/status", "get", "getKeyboxStatus",
          "Reevaluate current time, roots and cached CRL; no private decryption or network fetch.",
          ref("StatusResult"), errors=["404"])
operation(prefix + "/keyboxes/{id}/download", "get", "downloadKeybox",
          "Guest download requires global enable AND per-record permission AND public visibility.",
          None, binary=True, errors=["404"])
operation(prefix + "/certificates/status", "get", "getCertificateStatus",
          "Exactly one selector required. Serial is hex; absent CRL entry does not prove validity.",
          ref("CertificatePage"), params=pages + [
              {"name": "serial_number", "in": "query", "schema": S,
               "description": "Hex, optionally 0x/colon separated; mutually exclusive with fingerprint."},
              {"name": "fingerprint_sha256", "in": "query", "schema": S,
               "description": "64 hex digits ignoring colons; mutually exclusive with serial."}],
          errors=["400"])
operation(prefix + "/admin/setup", "get", "adminSetupStatus",
          "Get first-administrator initialization state; missing or corrupt database state fails closed.",
          ref("AdminSetupStatus"), preauth=True)
operation(prefix + "/admin/setup", "post", "adminSetup",
          "Create the first administrator with deployment token; permanently closes setup, audits atomically, no automatic login.",
          ref("AdminSetupResult"), preauth=True, request=body(ref("AdminSetupInput")),
          status="201", errors=["400", "401", "409", "415"])
operation(prefix + "/admin/login", "post", "adminLogin", "Login and create secure, eight-hour cookie session.",
          ref("LoginResult"), preauth=True, request=body(ref("LoginInput")), errors=["400", "401", "415"])
operation(prefix + "/admin/logout", "post", "adminLogout", "Revoke session and clear cookie.",
          {"nullable": True, "description": "Always null."}, admin=True)
operation(prefix + "/admin/me", "get", "adminMe", "Get identity and current session CSRF token.",
          ref("Me"), admin=True)
operation(prefix + "/admin/keyboxes", "get", "adminListKeyboxes", "Include hidden keyboxes; exclude soft-deleted.",
          ref("AdminKeyboxSummaryPage"), admin=True, params=pages + [param("Status"), param("Policy")], errors=["400"])
operation(prefix + "/admin/keyboxes/{id}", "get", "adminGetKeybox", "Get admin metadata without secrets.",
          ref("AdminKeyboxDetail"), admin=True, errors=["404"])
operation(prefix + "/admin/keyboxes/{id}/revalidate", "post", "adminRevalidateKeybox",
          "Run full validation and atomically persist history and audit.",
          ref("Validation"), admin=True, errors=["404", "409"])
operation(prefix + "/admin/keyboxes/{id}", "patch", "adminPatchKeybox", "Update visibility, note or guest policy.",
          ref("AdminKeyboxDetail"), admin=True, request=body(ref("KeyboxPatch")), errors=["400", "404", "415"])
operation(prefix + "/admin/keyboxes/{id}", "delete", "adminDeleteKeybox", "Soft-delete and retain deduplication.",
          obj({"id": ID, "deleted": {"type": "boolean", "enum": [True]}}), admin=True, errors=["404"])
operation(prefix + "/admin/keyboxes/{id}/validation-runs", "get", "adminListValidationRuns",
          "Get reproducible safe validation history.",
          ref("ValidationRunPage"), admin=True, params=pages, errors=["400", "404"])
operation(prefix + "/admin/keyboxes/{id}/download", "get", "adminDownloadKeybox",
          "Authenticated audited original download; GET needs no CSRF, limits still apply.",
          None, admin=True, binary=True, errors=["404"])
operation(prefix + "/admin/settings/guest-download", "get", "adminGetGuestDownloadSetting",
          "Get global guest download switch.", ref("GuestDownloadSetting"), admin=True)
operation(prefix + "/admin/settings/guest-download", "patch", "adminSetGuestDownloadSetting",
          "Global false overrides allowed. Enabling requires explicit sensitive-download confirmation.",
          ref("GuestDownloadSetting"), admin=True, request=body(ref("GuestDownloadSetting")),
          errors=["400", "409", "415"], params=[
              {"name": "X-Confirm-Guest-Download", "in": "header", "required": False,
               "schema": {"type": "string", "enum": ["enable-sensitive-downloads"]},
               "description": "Required when enabled=true; caller must display a second confirmation."}])
operation(prefix + "/admin/audit-logs", "get", "adminListAuditLogs", "Read append-only audit events.",
          ref("AuditLogPage"), admin=True, params=pages + [
              {"name": "action", "in": "query", "schema": {"type": "string", "maxLength": 64}}],
          errors=["400"])
operation(prefix + "/admin/download-logs", "get", "adminListDownloadLogs", "Read append-only download events.",
          ref("DownloadLogPage"), admin=True, params=pages, errors=["400"])
health = operation(prefix + "/admin/system/health", "get", "adminHealth", "Get dependency and policy health.",
                   ref("Health"), admin=True)
health["responses"]["503"] = {
    "description": "50302 includes Health; database/authentication outages may return 50301 with null data.",
    "headers": headers, "content": {"application/json": {
        "schema": envelope({"nullable": True, "allOf": [ref("Health")]}, False)}}}
operation(prefix + "/admin/system/crl/refresh", "post", "adminRefreshCRL",
          "Fetch conditional CRL update; failure never extends stale cache.",
          ref("CRLRefresh"), admin=True)
operation("/healthz", "get", "liveness", "Process liveness, no dependency guarantees.",
          obj({"status": {"type": "string", "enum": ["up"]}}))

document = {
    "openapi": "3.0.3",
    "info": {"title": "Keybox Collection API", "version": "1.0.0",
             "description": "Private key material is only released by explicit download endpoints. "
                            "Guest downloads default to false. All JSON envelopes contain a request_id. "
                            "See docs/api.md for error semantics, normalization, limits and status freshness."},
    "servers": [{"url": "/", "description": "Same-origin HTTPS deployment"}],
    "tags": [{"name": "Public"}, {"name": "Admin"}],
    "paths": paths,
    "components": {"schemas": schemas, "parameters": parameters, "responses": responses,
                   "securitySchemes": {
                       "AdminSession": {"type": "apiKey", "in": "cookie", "name": "__Host-keybox_session"},
                       "CSRFToken": {"type": "apiKey", "in": "header", "name": "X-CSRF-Token"}}},
}

target = pathlib.Path(__file__).resolve().parents[1] / "api" / "openapi.json"
serialized = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
if "--check" in sys.argv:
    if not target.exists() or target.read_text(encoding="utf-8") != serialized:
        raise SystemExit("OpenAPI artifact is stale; regenerate it.")
    print("OpenAPI artifact is current.")
else:
    target.parent.mkdir(exist_ok=True)
    target.write_text(serialized, encoding="utf-8", newline="\n")
    print(f"Generated {len(paths)} paths / {sum(len(v) for v in paths.values())} operations.")
