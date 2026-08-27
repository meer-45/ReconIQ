// web/src/api/client.ts — Typed fetch client for ReconIQ backend API.

import {
  OverviewResponseSchema,
  ExceptionsListResponseSchema,
  ExceptionDetailResponseSchema,
  ApproveExceptionResponseSchema,
  MatchGroupDetailResponseSchema,
  TransactionDetailResponseSchema,
  NearestMissResponseSchema,
  QaResponseSchema,
  type OverviewResponse,
  type ExceptionsListResponse,
  type ExceptionDetailResponse,
  type ApproveExceptionRequest,
  type ApproveExceptionResponse,
  type MatchGroupDetailResponse,
  type TransactionDetailResponse,
  type NearestMissResponse,
  type QaResponse,
} from "./schemas";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000/api";

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public requestId?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  schema?: { parse: (data: unknown) => T }
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  const response = await fetch(url, { ...options, headers });
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      `Failed to parse response JSON from ${path}`,
      response.status
    );
  }

  if (!response.ok) {
    throw new ApiError(
      data?.error || `HTTP ${response.status}: ${response.statusText}`,
      response.status,
      data?.requestId,
      data?.details
    );
  }

  if (schema) {
    return schema.parse(data);
  }

  return data as T;
}

export const api = {
  /**
   * GET /api/overview
   */
  async getOverview(): Promise<OverviewResponse> {
    return request<OverviewResponse>("/overview", { method: "GET" }, OverviewResponseSchema);
  },

  /**
   * GET /api/exceptions?classification=&sortBy=&order=&limit=&offset=
   */
  async getExceptions(params: {
    classification?: string;
    sortBy?: string;
    order?: "asc" | "desc";
    limit?: number;
    offset?: number;
  } = {}): Promise<ExceptionsListResponse> {
    const query = new URLSearchParams();
    if (params.classification && params.classification !== "ALL") {
      query.set("classification", params.classification);
    }
    if (params.sortBy) query.set("sortBy", params.sortBy);
    if (params.order) query.set("order", params.order);
    if (params.limit !== undefined) query.set("limit", params.limit.toString());
    if (params.offset !== undefined) query.set("offset", params.offset.toString());

    const qs = query.toString();
    const path = `/exceptions${qs ? `?${qs}` : ""}`;
    return request<ExceptionsListResponse>(path, { method: "GET" }, ExceptionsListResponseSchema);
  },

  /**
   * GET /api/exceptions/:id
   */
  async getException(id: string): Promise<ExceptionDetailResponse> {
    return request<ExceptionDetailResponse>(
      `/exceptions/${encodeURIComponent(id)}`,
      { method: "GET" },
      ExceptionDetailResponseSchema
    );
  },

  /**
   * POST /api/exceptions/:id/approve
   */
  async approveException(
    id: string,
    data: ApproveExceptionRequest
  ): Promise<ApproveExceptionResponse> {
    return request<ApproveExceptionResponse>(
      `/exceptions/${encodeURIComponent(id)}/approve`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
      ApproveExceptionResponseSchema
    );
  },

  /**
   * POST /api/exceptions/:id/reject
   */
  async rejectException(
    id: string,
    data: { actorId?: string; reason?: string } = {}
  ): Promise<{ status: string; auditTrailId: string; message: string }> {
    return request<{ status: string; auditTrailId: string; message: string }>(
      `/exceptions/${encodeURIComponent(id)}/reject`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
  },

  /**
   * POST /api/exceptions/:id/resolve
   */
  async resolveException(
    id: string,
    data: { actorId?: string; reason?: string } = {}
  ): Promise<{ status: string; auditTrailId: string; message: string }> {
    return request<{ status: string; auditTrailId: string; message: string }>(
      `/exceptions/${encodeURIComponent(id)}/resolve`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
  },

  /**
   * GET /api/match-groups/:id
   */
  async getMatchGroup(id: string): Promise<MatchGroupDetailResponse> {
    return request<MatchGroupDetailResponse>(
      `/match-groups/${encodeURIComponent(id)}`,
      { method: "GET" },
      MatchGroupDetailResponseSchema
    );
  },

  /**
   * GET /api/transactions/:id
   */
  async getTransaction(id: string): Promise<TransactionDetailResponse> {
    return request<TransactionDetailResponse>(
      `/transactions/${encodeURIComponent(id)}`,
      { method: "GET" },
      TransactionDetailResponseSchema
    );
  },

  /**
   * GET /api/transactions/:id/nearest-miss
   */
  async getNearestMiss(id: string): Promise<NearestMissResponse> {
    return request<NearestMissResponse>(
      `/transactions/${encodeURIComponent(id)}/nearest-miss`,
      { method: "GET" },
      NearestMissResponseSchema
    );
  },

  /**
   * POST /api/qa
   */
  async askQa(question: string): Promise<QaResponse> {
    return request<QaResponse>(
      "/qa",
      {
        method: "POST",
        body: JSON.stringify({ question }),
      },
      QaResponseSchema
    );
  },
};
