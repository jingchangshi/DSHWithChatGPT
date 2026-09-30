export interface McpExposureBinding {
  workspaceId: string
  loopbackEndpoint: string
  authorizationReference: string
}
export interface McpExposureStatus { ready: boolean; endpoint?: string; detail?: string }
/** Network exposure grants no workspace or execution authority. */
export interface McpExposureProvider {
  ensure(binding: McpExposureBinding, signal?: AbortSignal): Promise<McpExposureStatus>
  status(signal?: AbortSignal): Promise<McpExposureStatus>
  rebind(binding: McpExposureBinding, signal?: AbortSignal): Promise<McpExposureStatus>
  close(signal?: AbortSignal): Promise<void>
}
