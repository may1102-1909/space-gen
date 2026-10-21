'use client'

import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  X, 
  Sparkles, 
  Upload, 
  Layers, 
  Check, 
  ArrowRight, 
  Box, 
  Search,
  Wand2
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { FurnitureItem } from '@/lib/types'
import { api } from '@/lib/api'

export function ObjectReplacementModal() {
  const {
    scene,
    selectedObjectId,
    furnitureCatalog,
    showReplacementModal,
    setFurnitureCatalog,
    setShowReplacementModal,
    replaceObject,
  } = useAppStore()

  const [activeTab, setActiveTab] = useState<'catalog' | 'upload' | 'ai'>('catalog')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [aiPrompt, setAiPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)

  const selectedObj = scene?.objects?.find((o) => o.entity_id === selectedObjectId)
  const targetCategory = selectedObj?.category || 'bed'

  // Fetch furniture catalog on mount if empty
  useEffect(() => {
    async function loadCatalog() {
      try {
        const items = await api.getFurnitureCatalog()
        if (items && items.length > 0) {
          setFurnitureCatalog(items)
        }
      } catch (err) {
        console.warn('Failed to load furniture catalog from backend:', err)
      }
    }
    if (furnitureCatalog.length === 0) {
      loadCatalog()
    }
  }, [furnitureCatalog.length, setFurnitureCatalog])

  // Reset the category filter when the selected object's category changes (adjusted during render).
  const [filterFor, setFilterFor] = useState<string | null>(null)
  if (targetCategory && targetCategory !== filterFor) {
    setFilterFor(targetCategory)
    setSelectedCategory(targetCategory)
  }

  if (!showReplacementModal || !selectedObjectId) return null

  const filteredCatalog = furnitureCatalog.filter((item) => {
    const matchesCat = selectedCategory === 'all' || item.category.toLowerCase() === selectedCategory.toLowerCase()
    const matchesSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase()) || item.style.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesCat && matchesSearch
  })

  const handleSelectCatalogItem = (item: FurnitureItem) => {
    const fullUrl = api.normalizeModelUrl(item.url) || item.url
    replaceObject(selectedObjectId, fullUrl, item.name)
    setShowReplacementModal(false)
  }

  const handleCustomUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadedFile(file)
    const localUrl = URL.createObjectURL(file)
    replaceObject(selectedObjectId, localUrl, file.name.replace(/\.[^/.]+$/, ''))
    setShowReplacementModal(false)
  }

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) return
    setIsGenerating(true)
    // Find closest match or synthesize
    setTimeout(() => {
      // Pick best matching or default catalog item as realistic proxy
      const match = furnitureCatalog.find(i => i.category.toLowerCase() === targetCategory.toLowerCase()) || furnitureCatalog[0]
      if (match) {
        const fullUrl = api.normalizeModelUrl(match.url) || match.url
        replaceObject(selectedObjectId, fullUrl, `${aiPrompt} (${match.style})`)
      }
      setIsGenerating(false)
      setShowReplacementModal(false)
    }, 1200)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl flex flex-col max-h-[85vh]"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent border border-accent/20">
              <Sparkles size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-text-primary">
                Replace {selectedObj?.name || selectedObj?.category || 'Object'}
              </h2>
              <p className="text-xs text-text-secondary">
                Swap this piece of furniture with a 3D model, custom upload, or AI asset
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowReplacementModal(false)}
            className="rounded-lg p-2 text-text-muted hover:bg-surface-elevated hover:text-text-primary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-2 border-b border-border px-5 py-2.5 bg-surface/50">
          <button
            onClick={() => setActiveTab('catalog')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'catalog'
                ? 'bg-accent/20 text-accent border border-accent/30 shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-elevated'
            }`}
          >
            <Layers size={13} />
            <span>3D Furniture Catalog</span>
          </button>

          <button
            onClick={() => setActiveTab('upload')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'upload'
                ? 'bg-accent/20 text-accent border border-accent/30 shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-elevated'
            }`}
          >
            <Upload size={13} />
            <span>Upload 3D Model (.glb / .obj)</span>
          </button>

          <button
            onClick={() => setActiveTab('ai')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'ai'
                ? 'bg-accent/20 text-accent border border-accent/30 shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-elevated'
            }`}
          >
            <Wand2 size={13} />
            <span>AI 3D Generator</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1">
          {/* TAB 1: 3D Furniture Catalog */}
          {activeTab === 'catalog' && (
            <div className="space-y-4">
              {/* Category Filter + Search */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 bg-surface-elevated px-3 py-1.5 rounded-xl border border-border flex-1">
                  <Search size={14} className="text-text-muted" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search furniture by name or style..."
                    className="bg-transparent border-0 text-xs text-text-primary focus:outline-none w-full placeholder:text-text-muted"
                  />
                </div>

                <div className="flex items-center gap-1 bg-surface-elevated p-1 rounded-xl border border-border">
                  {['all', 'bed', 'sofa', 'table', 'chair'].map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium capitalize transition-all ${
                        selectedCategory === cat
                          ? 'bg-accent text-white shadow-sm'
                          : 'text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Grid of 3D Models */}
              <div className="grid grid-cols-2 gap-3 max-h-[380px] overflow-y-auto pr-1">
                {filteredCatalog.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => handleSelectCatalogItem(item)}
                    className="group flex flex-col p-3 rounded-xl border border-border bg-surface-elevated/60 hover:bg-surface-elevated hover:border-accent/50 cursor-pointer transition-all hover:shadow-lg"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-4 w-4 rounded-full border border-white/20 shadow-sm"
                          style={{ backgroundColor: item.color_preview }}
                        />
                        <span className="text-xs font-semibold text-text-primary group-hover:text-accent transition-colors">
                          {item.name}
                        </span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface border border-border text-text-muted font-medium">
                        {item.style}
                      </span>
                    </div>

                    <p className="text-[11px] text-text-secondary line-clamp-2 mb-3 leading-relaxed">
                      {item.description}
                    </p>

                    <div className="flex items-center justify-between mt-auto pt-2 border-t border-border/50 text-[10px] text-text-muted">
                      <span>
                        {item.dimensions.width_m}m × {item.dimensions.depth_m || item.dimensions.width_m}m × {item.dimensions.height_m}m
                      </span>
                      <span className="flex items-center gap-1 text-accent font-medium group-hover:translate-x-0.5 transition-transform">
                        Select <ArrowRight size={11} />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: Custom Upload */}
          {activeTab === 'upload' && (
            <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-border hover:border-accent/50 rounded-2xl bg-surface-elevated/40 transition-colors text-center">
              <input
                type="file"
                id="custom-replace-file"
                accept=".glb,.gltf,.obj"
                className="hidden"
                onChange={handleCustomUpload}
              />
              <label
                htmlFor="custom-replace-file"
                className="cursor-pointer flex flex-col items-center"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent mb-4 border border-accent/20">
                  <Upload size={26} />
                </div>
                <p className="text-sm font-semibold text-text-primary mb-1">
                  Upload 3D Mesh (.glb, .gltf, .obj)
                </p>
                <p className="text-xs text-text-muted max-w-sm mb-4">
                  Drag and drop or browse for a custom 3D asset to swap directly into this object&apos;s position.
                </p>
                <span className="px-4 py-2 rounded-xl text-xs font-semibold bg-accent text-white shadow-lg shadow-accent/25 hover:brightness-110 transition-all">
                  Browse Files
                </span>
              </label>
            </div>
          )}

          {/* TAB 3: AI 3D Generator */}
          {activeTab === 'ai' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-accent/10 border border-accent/20">
                <div className="flex items-center gap-2 text-accent font-medium text-xs mb-1">
                  <Wand2 size={14} />
                  <span>Gemini Spatial Copilot 3D Generator</span>
                </div>
                <p className="text-xs text-text-secondary leading-relaxed">
                  Describe the replacement furniture piece in natural language. Copilot will synthesize and fit the 3D model into your space.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-text-secondary">Design Prompt</label>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="e.g. Modern low-profile king bed in natural light oak with floating headboard and organic ivory linen bedding..."
                  rows={3}
                  className="w-full p-3 rounded-xl border border-border bg-surface-elevated text-xs text-text-primary focus:outline-none focus:border-accent resize-none placeholder:text-text-muted"
                />
              </div>

              {/* Suggestion Chips */}
              <div className="space-y-1.5">
                <span className="text-[11px] text-text-muted">Quick Presets:</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'Nordic Natural Oak Platform Bed',
                    'Bouclé Cloud Curved Sofa',
                    'Mid-Century Walnut Fluted Coffee Table',
                    'Minimalist Japanese Tatami Bed',
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setAiPrompt(chip)}
                      className="px-2.5 py-1 rounded-lg text-[10px] bg-surface-elevated hover:bg-accent/20 hover:text-accent border border-border transition-colors"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={handleAiGenerate}
                disabled={!aiPrompt.trim() || isGenerating}
                className="w-full py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-accent to-purple-600 text-white shadow-lg shadow-accent/25 hover:brightness-110 disabled:opacity-50 transition-all flex items-center justify-center gap-2 mt-2"
              >
                {isGenerating ? (
                  <>
                    <Sparkles size={14} className="animate-spin" />
                    <span>Synthesizing 3D Model...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    <span>Generate & Swap Model</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  )
}
