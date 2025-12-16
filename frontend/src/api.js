// API Service - handles all backend API calls with authentication
import { getIdToken } from './firebase.js'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

/**
 * Make an authenticated API request
 */
async function apiRequest(endpoint, options = {}) {
  const token = await getIdToken()
  
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers
    }
  })
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || error.message || `API error: ${response.status}`)
  }
  
  return response.json()
}

// ========== Image Generation APIs ==========

/**
 * Generate image with FIBO (structured prompt)
 * @param {Object} params - { structuredPrompt, prompt, seed, imageBase64 }
 */
export async function generateImage(params) {
  return apiRequest('/api/generate-image', {
    method: 'POST',
    body: JSON.stringify(params)
  })
}

/**
 * Generate initial scene from reference image
 * @param {Object} params - { imageBase64, mimeType, analysisPrompt }
 */
export async function generateScene(params) {
  return apiRequest('/api/generate-scene', {
    method: 'POST',
    body: JSON.stringify(params)
  })
}

/**
 * Analyze image with Gemini (text-only or with image)
 * @param {Object} params - { prompt, model?, json?, imageBase64?, mimeType?, imageUrl? }
 */
export async function analyzeImage(params) {
  return apiRequest('/api/analyze-image', {
    method: 'POST',
    body: JSON.stringify(params)
  })
}

/**
 * Detect bounding boxes in image
 * @param {Object} params - { prompt, imageUrl }
 */
export async function detectBoundingBoxes(params) {
  return apiRequest('/api/detect-bboxes', {
    method: 'POST',
    body: JSON.stringify(params)
  })
}

// ========== 3D Model Generation APIs ==========

/**
 * Generate 3D model with Trellis
 * @param {Object} params - { imageUrl }
 */
export async function generate3DModel(params) {
  return apiRequest('/api/generate-3d-model', {
    method: 'POST',
    body: JSON.stringify(params)
  })
}

// ========== FIBO Render API ==========

/**
 * FIBO Render (existing endpoint)
 * @param {Object} params - { screenshot }
 */
export async function fiboRender(params) {
  return apiRequest('/api/fibo-render', {
    method: 'POST',
    body: JSON.stringify(params)
  })
}

// ========== Utility APIs ==========

/**
 * Fetch OpenGraph metadata
 * @param {string} url - URL to fetch metadata from
 */
export async function fetchOpenGraph(url) {
  return apiRequest('/api/fetch-opengraph', {
    method: 'POST',
    body: JSON.stringify({ url })
  })
}

/**
 * Get user quota info
 */
export async function getQuota() {
  return apiRequest('/api/quota', {
    method: 'GET'
  })
}
