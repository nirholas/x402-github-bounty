// GENERATED from openapi.json — do not edit by hand.
//
// Per-route invocation contracts published inside the x402 402 challenge as
// `accepts[].outputSchema`. `input` tells an agent how to build the request
// (method, query/path params, JSON body fields); `output` is the JSON Schema of
// the 200 body it gets back once payment settles.
//
// Deriving these from `openapi.json` keeps the runtime challenge — which the
// x402scan discovery spec treats as authoritative — from ever contradicting the
// published spec. Regenerate whenever a paid route's parameters or response
// schema change.
//
// Keys match the paywall route map in `server.ts` exactly (`"<METHOD> <path>"`,
// with `:param` for path segments).

import type { RouteSchema } from "./payments.js";

export const ROUTE_SCHEMAS: Record<string, RouteSchema> = {
  "POST /bounties": {
    "input": {
      "type": "http",
      "method": "POST",
      "bodyType": "json",
      "bodyFields": {
        "issueUrl": {
          "type": "string",
          "example": "https://github.com/owner/repo/issues/123",
          "x-required": true
        },
        "amount": {
          "type": "number",
          "exclusiveMinimum": 0,
          "x-required": true
        },
        "terms": {
          "type": "string"
        },
        "funder": {
          "type": "string"
        },
        "expiryDays": {
          "type": "integer",
          "minimum": 1,
          "maximum": 365
        }
      }
    },
    "output": {
      "type": "object",
      "properties": {
        "certificate": {
          "type": "object",
          "properties": {
            "type": {
              "type": "string"
            },
            "bountyId": {
              "type": "string"
            },
            "issueUrl": {
              "type": "string"
            },
            "repo": {
              "type": "string"
            },
            "issueNumber": {
              "type": "integer"
            },
            "issueTitle": {
              "type": "string"
            },
            "amount": {
              "type": "string"
            },
            "currency": {
              "type": "string"
            },
            "terms": {
              "type": "string"
            },
            "funder": {
              "type": [
                "string",
                "null"
              ]
            },
            "createdAt": {
              "type": "string",
              "format": "date-time"
            },
            "expiresAt": {
              "type": "string",
              "format": "date-time"
            }
          }
        },
        "signature": {
          "type": "string"
        },
        "settleKey": {
          "type": "string"
        },
        "settleKeyNote": {
          "type": "string"
        },
        "verifyUrl": {
          "type": "string"
        },
        "algorithm": {
          "type": "string"
        },
        "receipt": {
          "type": [
            "object",
            "null"
          ]
        }
      }
    }
  },
  "GET /verify/:bountyId": {
    "input": {
      "type": "http",
      "method": "GET",
      "queryParams": {},
      "pathParams": {
        "bountyId": {
          "type": "string",
          "x-required": true
        }
      }
    },
    "output": {
      "type": "object",
      "properties": {
        "report": {
          "type": "object",
          "properties": {
            "type": {
              "type": "string"
            },
            "bountyId": {
              "type": "string"
            },
            "issueUrl": {
              "type": "string"
            },
            "bountyStatus": {
              "type": "string"
            },
            "amount": {
              "type": "string"
            },
            "issue": {
              "type": "object",
              "properties": {
                "state": {
                  "type": "string"
                },
                "closedAt": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "stateReason": {
                  "type": [
                    "string",
                    "null"
                  ]
                }
              }
            },
            "mergedPrs": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "number": {
                    "type": "integer"
                  },
                  "title": {
                    "type": "string"
                  },
                  "author": {
                    "type": [
                      "string",
                      "null"
                    ]
                  },
                  "url": {
                    "type": "string"
                  },
                  "mergedAt": {
                    "type": "string"
                  },
                  "mergeCommit": {
                    "type": [
                      "string",
                      "null"
                    ]
                  }
                }
              }
            },
            "eligible": {
              "type": "boolean"
            },
            "eligibleReason": {
              "type": "string"
            },
            "source": {
              "type": "string"
            },
            "checkedAt": {
              "type": "string",
              "format": "date-time"
            }
          }
        },
        "signature": {
          "type": "string"
        },
        "algorithm": {
          "type": "string"
        },
        "receipt": {
          "type": [
            "object",
            "null"
          ]
        }
      }
    }
  },
};
