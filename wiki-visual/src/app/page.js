'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, ChevronRight, X, Loader2, Info, Box, Globe, Map as MapIcon, Tag,
  ExternalLink, RotateCcw, AlertTriangle, Layers, Route
} from 'lucide-react';
import * as THREE from 'three';
import dynamic from 'next/dynamic';

const ForceGraph3D = dynamic(
    () => import('react-force-graph-3d'),
    { ssr: false }
);

// 16 категорий
const CATEGORIES = {
  0:  { name: 'World & Religion', color: '#ef4444' },
  1:  { name: 'Biology & Species', color: '#22c55e' },
  2:  { name: 'Sports', color: '#f97316' },
  3:  { name: 'Film & Hollywood', color: '#f43f5e' },
  4:  { name: 'US Geography', color: '#fcd34d' },
  5:  { name: 'Central Europe', color: '#0ea5e9' },
  6:  { name: 'Music Industry', color: '#a855f7' },
  7:  { name: 'South Asia & Languages', color: '#14b8a6' },
  8:  { name: 'France', color: '#6366f1' },
  9:  { name: 'United Kingdom', color: '#be123c' },
  10: { name: 'Tech & Gaming', color: '#3b82f6' },
  11: { name: 'US Politics', color: '#991b1b' },
  12: { name: 'World Nations', color: '#64748b' },
  13: { name: 'Calendar & Time', color: '#eab308' },
  14: { name: 'Medicine & Health', color: '#06b6d4' },
  15: { name: 'Classical Arts', color: '#b45309' },
};

const TOP_CLUSTER_IDS = Object.keys(CATEGORIES).map(Number);
const DEFAULT_COLOR = '#475569';
const DIM_FACTOR = 0.08;
const PATH_DIM_FACTOR = 0.05;
const PATH_LINK_COLOR = '#fbbf24';
const PATH_PARTICLE_COLOR = '#fde047';

let sortedTitles = [];

function searchTitles(query, limit = 7) {
  if (!sortedTitles.length) return [];
  const q = query.toLowerCase();
  let left = 0, right = sortedTitles.length;
  while (left < right) {
    const mid = (left + right) >> 1;
    if (sortedTitles[mid].title < q) left = mid + 1;
    else right = mid;
  }
  const results = [];
  for (let i = left; i < sortedTitles.length && results.length < limit; i++) {
    if (sortedTitles[i].title.startsWith(q)) {
      results.push(sortedTitles[i]);
    } else break;
  }
  return results;
}

export default function Home() {
  const [startId, setStartId] = useState('');
  const [endId, setEndId] = useState('');
  const [startQuery, setStartQuery] = useState('');
  const [endQuery, setEndQuery] = useState('');
  const [startSuggestions, setStartSuggestions] = useState([]);
  const [endSuggestions, setEndSuggestions] = useState([]);
  const [activeField, setActiveField] = useState(null);

  const [loading, setLoading] = useState(false);
  const [pathData, setPathData] = useState(null);

  const [allNodes, setAllNodes] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [hoveredTitle, setHoveredTitle] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [viewMode, setViewMode] = useState('galaxy');
  const [legendOpen, setLegendOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const graphRef = useRef();
  const pointCloudRef = useRef(null);
  const tooltipRef = useRef(null);

  // Загрузка данных
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (fetchedRef.current) return; // защита от двойного вызова в React StrictMode (dev)
    fetchedRef.current = true;

    const t0 = performance.now();
    fetch('/api/nodes')
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then(data => {
          console.log(`✅ Fetched ${data.length} nodes in ${(performance.now() - t0).toFixed(0)}ms`);
          const processed = data.map(node => {
            const isTop = CATEGORIES[node.cluster_id] !== undefined;
            const baseColor = isTop
                ? new THREE.Color(CATEGORIES[node.cluster_id].color)
                : new THREE.Color(DEFAULT_COLOR);
            return {
              ...node,
              baseColor,
              brightness: 0.6 + Math.random() * 0.4,
              mainCatId: isTop ? node.cluster_id : null,
            };
          });
          setAllNodes(processed);

          sortedTitles = processed.map(n => ({ id: n.id, title: n.title.toLowerCase() }));
          sortedTitles.sort((a, b) => a.title.localeCompare(b.title));

          setIsInitializing(false);
        })
        .catch(err => {
          console.error('Failed to load nodes:', err);
          setIsInitializing(false);
        });
  }, []);

  const nodesById = useMemo(() => {
    const map = new Map();
    allNodes.forEach(n => map.set(n.id, n));
    return map;
  }, [allNodes]);

  const clusterCounts = useMemo(() => {
    const counts = {};
    TOP_CLUSTER_IDS.forEach(id => { counts[id] = 0; });
    let otherCount = 0;
    allNodes.forEach(node => {
      if (CATEGORIES[node.cluster_id]) {
        counts[node.cluster_id] = (counts[node.cluster_id] || 0) + 1;
      } else {
        otherCount++;
      }
    });
    return { ...counts, other: otherCount };
  }, [allNodes]);

  const pathNodeIdSet = useMemo(() => {
    return pathData ? new Set(pathData) : null;
  }, [pathData]);

  // ----- Единый эффект: создание/обновление облака точек -----
  useEffect(() => {
    if (allNodes.length === 0 || !graphRef.current) return;

    const scene = graphRef.current.scene();
    if (!scene) return;

    let pointCloud = pointCloudRef.current;
    const numPoints = allNodes.length;

    // Если облака ещё нет – создаём
    if (!pointCloud) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(numPoints * 3);
      const colors = new Float32Array(numPoints * 3);

      // Центры кластеров для 16 категорий
      const clusterCenters = TOP_CLUSTER_IDS.map((_, i) => {
        const radius = 4200;
        const angle = (i / TOP_CLUSTER_IDS.length) * Math.PI * 2;
        return {
          x: Math.cos(angle) * radius,
          y: (Math.random() - 0.5) * 1600,
          z: Math.sin(angle) * radius,
        };
      });

      allNodes.forEach((node, i) => {
        // Приводим cluster_id к числу
        const clusterId = Number(node.cluster_id);
        const isTop = CATEGORIES[clusterId] !== undefined;
        // Ищем индекс, только если категория топовая
        let centerIdx = -1;
        if (isTop) {
          centerIdx = TOP_CLUSTER_IDS.indexOf(clusterId);
        }
        // Если индекс не найден – используем центр (0,0,0)
        const center = (isTop && centerIdx !== -1) ? clusterCenters[centerIdx] : { x: 0, y: 0, z: 0 };

        const r = (isTop ? 1800 : 6000) * Math.pow(Math.random(), 2);
        const theta = Math.random() * 2 * Math.PI;
        const phi = Math.acos(2 * Math.random() - 1);

        node.galX = center.x + r * Math.sin(phi) * Math.cos(theta);
        node.galY = center.y + r * Math.sin(phi) * Math.sin(theta);
        node.galZ = center.z + r * Math.cos(phi);

        node.planeX = node.galX;
        node.planeY = (Math.random() - 0.5) * 100;
        node.planeZ = node.galZ;

        const cubeSize = 5000;
        node.cubeX = (Math.random() - 0.5) * cubeSize;
        node.cubeY = (Math.random() - 0.5) * cubeSize;
        node.cubeZ = (Math.random() - 0.5) * cubeSize;

        // Начальные позиции (galaxy)
        positions[i*3] = node.galX;
        positions[i*3+1] = node.galY;
        positions[i*3+2] = node.galZ;
        node.x = node.galX; node.y = node.galY; node.z = node.galZ;

        // Начальные цвета (с учётом яркости)
        const base = node.baseColor;
        const b = node.brightness;
        colors[i*3] = base.r * b;
        colors[i*3+1] = base.g * b;
        colors[i*3+2] = base.b * b;
      });

      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const material = new THREE.PointsMaterial({
        size: 2,
        vertexColors: true,
        transparent: true,
        opacity: 0.65,
        sizeAttenuation: false,
        depthWrite: false
      });

      pointCloud = new THREE.Points(geometry, material);
      scene.add(pointCloud);
      pointCloudRef.current = pointCloud;
    }

    // Теперь обновляем позиции и цвета в зависимости от текущих параметров
    const geometry = pointCloud.geometry;
    const posAttr = geometry.attributes.position;
    const colorAttr = geometry.attributes.color;
    if (!posAttr || !colorAttr) return;

    const positions = posAttr.array;
    const colors = colorAttr.array;

    const isPathMode = pathNodeIdSet !== null;
    const isFilterMode = selectedCategory !== null;

    for (let i = 0; i < numPoints; i++) {
      const node = allNodes[i];

      // Позиции
      let x = node.galX, y = node.galY, z = node.galZ;
      if (viewMode === 'plane') { x = node.planeX; y = node.planeY; z = node.planeZ; }
      if (viewMode === 'cube') { x = node.cubeX; y = node.cubeY; z = node.cubeZ; }
      positions[i*3] = x;
      positions[i*3+1] = y;
      positions[i*3+2] = z;
      node.x = x; node.y = y; node.z = z;

      // Цвета
      const base = node.baseColor;
      let dim = 1;
      if (isPathMode) {
        dim = pathNodeIdSet.has(node.id) ? 1 : PATH_DIM_FACTOR;
      } else if (isFilterMode) {
        const matches = (selectedCategory === 'other')
            ? (node.mainCatId === null)
            : (node.mainCatId === selectedCategory);
        dim = matches ? 1 : DIM_FACTOR;
      }
      const b = node.brightness;
      colors[i*3] = base.r * b * dim;
      colors[i*3+1] = base.g * b * dim;
      colors[i*3+2] = base.b * b * dim;
    }

    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;

  }, [allNodes, viewMode, selectedCategory, pathNodeIdSet]);

  // Рейкастинг для двойного клика
  useEffect(() => {
    if (!graphRef.current || allNodes.length === 0) return;
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 14;
    const mouse = new THREE.Vector2();

    const onDoubleClick = (event) => {
      if (event.target.closest('button') || event.target.closest('input') || event.target.closest('.no-raycast')) return;
      if (!pointCloudRef.current || !graphRef.current) return;

      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

      raycaster.setFromCamera(mouse, graphRef.current.camera());
      const intersects = raycaster.intersectObject(pointCloudRef.current);

      if (intersects.length > 0) {
        const idx = intersects[0].index;
        if (idx >= 0 && idx < allNodes.length) {
          setSelectedNode(allNodes[idx]);
        }
      } else {
        setSelectedNode(null);
      }
    };

    window.addEventListener('dblclick', onDoubleClick);
    return () => window.removeEventListener('dblclick', onDoubleClick);
  }, [allNodes]);

  // Рейкастинг для наведения (tooltip)
  useEffect(() => {
    if (!graphRef.current || allNodes.length === 0) return;
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 14;
    const mouse = new THREE.Vector2();

    let rafPending = false;
    let lastEvent = null;
    let lastIndex = -1;

    const runRaycast = () => {
      rafPending = false;
      if (!lastEvent || !pointCloudRef.current || !graphRef.current) return;

      mouse.x = (lastEvent.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(lastEvent.clientY / window.innerHeight) * 2 + 1;

      raycaster.setFromCamera(mouse, graphRef.current.camera());
      const intersects = raycaster.intersectObject(pointCloudRef.current);
      const idx = intersects.length > 0 ? intersects[0].index : -1;

      if (tooltipRef.current) {
        tooltipRef.current.style.left = `${lastEvent.clientX + 14}px`;
        tooltipRef.current.style.top = `${lastEvent.clientY + 14}px`;
        tooltipRef.current.style.display = idx >= 0 ? 'block' : 'none';
      }
      document.body.style.cursor = idx >= 0 ? 'pointer' : '';

      if (idx !== lastIndex) {
        lastIndex = idx;
        setHoveredTitle(idx >= 0 && idx < allNodes.length ? allNodes[idx].title : null);
      }
    };

    const onMouseMove = (event) => {
      if (event.target.closest('.no-raycast')) return;
      lastEvent = event;
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(runRaycast);
    };

    window.addEventListener('mousemove', onMouseMove);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      document.body.style.cursor = '';
    };
  }, [allNodes]);

  // Данные для ForceGraph3D (путь)
  const graphData = useMemo(() => {
    const data = { nodes: [], links: [] };
    if (pathData && allNodes.length > 0) {
      const pathLength = pathData.length;
      const pathNodes = pathData.map(id => nodesById.get(id)).filter(Boolean);
      pathNodes.forEach((node, index) => {
        data.nodes.push({
          id: String(node.id),
          x: node.x, y: node.y, z: node.z,
          color: index === 0 ? '#10b981' : index === pathLength - 1 ? '#f43f5e' : '#ffffff'
        });
        if (index < pathLength - 1) {
          data.links.push({ source: String(node.id), target: String(pathData[index + 1]) });
        }
      });
    } else {
      data.nodes.push({ id: 'dummy', x: 0, y: 0, z: 0, color: 'rgba(0,0,0,0)' });
    }
    return data;
  }, [pathData, allNodes, nodesById]);

  const pathTitles = useMemo(() => {
    if (!pathData) return [];
    return pathData.map(id => nodesById.get(id)?.title || `#${id}`);
  }, [pathData, nodesById]);

  // Автокомплит с бинарным поиском
  useEffect(() => {
    if (activeField !== 'start' || startQuery.trim().length < 2) {
      setStartSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      setStartSuggestions(searchTitles(startQuery, 7));
    }, 150);
    return () => clearTimeout(t);
  }, [startQuery, activeField]);

  useEffect(() => {
    if (activeField !== 'end' || endQuery.trim().length < 2) {
      setEndSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      setEndSuggestions(searchTitles(endQuery, 7));
    }, 150);
    return () => clearTimeout(t);
  }, [endQuery, activeField]);

  const pickStart = useCallback((node) => {
    setStartId(String(node.id));
    setStartQuery(node.title);
    setStartSuggestions([]);
    setActiveField(null);
  }, []);

  const pickEnd = useCallback((node) => {
    setEndId(String(node.id));
    setEndQuery(node.title);
    setEndSuggestions([]);
    setActiveField(null);
  }, []);

  const resetView = useCallback(() => {
    if (!graphRef.current) return;
    graphRef.current.cameraPosition(
        { x: 0, y: viewMode === 'plane' ? 5500 : 0, z: 7000 },
        { x: 0, y: 0, z: 0 },
        800
    );
  }, [viewMode]);

  const findPath = useCallback(async () => {
    if (!startId || !endId) return;
    setLoading(true);
    setPathData(null);
    try {
      const res = await fetch(`/api/path?start=${startId}&end=${endId}`);
      const text = await res.text();
      if (!res.ok) {
        try {
          const err = JSON.parse(text);
          throw new Error(err.error);
        } catch {
          throw new Error(`Ошибка сервера ${res.status}`);
        }
      }
      const data = JSON.parse(text);
      setPathData(data.path);
    } catch (err) {
      setToast(err.message || 'Не удалось найти путь');
    } finally {
      setLoading(false);
    }
  }, [startId, endId]);

  // JSX (такой же как раньше, без изменений)
  return (
      <div className="relative w-full h-screen bg-black overflow-hidden font-sans text-neutral-50">
        {/* Tooltip */}
        <div
            ref={tooltipRef}
            className="fixed z-30 pointer-events-none px-2.5 py-1 rounded-md bg-black/80 border border-white/10 text-xs text-white backdrop-blur-sm"
            style={{ display: 'none' }}
        >
          {hoveredTitle}
        </div>

        <div className="absolute top-6 left-6 z-10 opacity-70 pointer-events-none">
          <h1 className="text-sm font-semibold tracking-wide flex items-center gap-2 text-white">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            Wikipedia Graph
          </h1>
          <p className="text-[10px] text-neutral-500 mt-1 uppercase tracking-widest">
            {isInitializing ? 'Loading AI Clusters...' : `${allNodes.length.toLocaleString()} Exact Nodes`}
          </p>
        </div>

        {!isInitializing && (
            <button
                onClick={() => setLegendOpen(v => !v)}
                className="sm:hidden absolute top-6 right-6 z-20 p-2.5 bg-neutral-900/80 border border-white/10 rounded-xl text-neutral-300 no-raycast"
            >
              <Layers className="w-4 h-4" />
            </button>
        )}

        {!isInitializing && (
            <div className={`${legendOpen ? 'flex' : 'hidden'} sm:flex absolute top-24 left-6 z-10 flex-col gap-1.5 no-raycast max-h-[62vh] overflow-y-auto pr-2 w-64 sm:w-auto`}>
              {selectedCategory !== null && (
                  <button
                      onClick={() => setSelectedCategory(null)}
                      className="text-[10px] uppercase tracking-widest text-neutral-400 hover:text-white text-left px-1 pb-0.5"
                  >
                    ← Show all categories
                  </button>
              )}
              {TOP_CLUSTER_IDS.map(id => {
                const isActive = selectedCategory === id;
                const isDimmed = selectedCategory !== null && !isActive;
                return (
                    <button
                        key={id}
                        onClick={() => setSelectedCategory(prev => prev === id ? null : id)}
                        className={`flex items-center justify-between gap-6 text-xs font-medium px-3 py-1.5 rounded-md border backdrop-blur-sm transition-colors text-left ${
                            isActive ? 'bg-white/10 border-white/30' : 'bg-black/40 border-white/5 hover:border-white/20'
                        } ${isDimmed ? 'opacity-40' : ''}`}
                    >
                      <div className="flex items-center gap-2 text-neutral-300">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CATEGORIES[id].color }} />
                        {CATEGORIES[id].name}
                      </div>
                      <span className="text-neutral-500 font-mono tracking-wide">
                        {clusterCounts[id]?.toLocaleString() || 0}
                      </span>
                    </button>
                );
              })}
              <button
                  onClick={() => setSelectedCategory(prev => prev === 'other' ? null : 'other')}
                  className={`flex items-center justify-between gap-6 text-xs font-medium px-3 py-1.5 rounded-md border backdrop-blur-sm transition-colors text-left mt-1 ${
                      selectedCategory === 'other' ? 'bg-white/10 border-white/30' : 'bg-black/40 border-white/5 hover:border-white/20'
                  } ${selectedCategory !== null && selectedCategory !== 'other' ? 'opacity-40' : ''}`}
              >
                <div className="flex items-center gap-2 text-neutral-500">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-600" />
                  Other
                </div>
                <span className="text-neutral-600 font-mono tracking-wide">
                  {clusterCounts.other?.toLocaleString() || 0}
                </span>
              </button>
            </div>
        )}

        <AnimatePresence>
          {selectedNode && (
              <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="absolute top-6 right-6 z-20 w-72 bg-neutral-900/90 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl no-raycast"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2 text-blue-400 mb-2">
                    <Info className="w-4 h-4" />
                    <span className="text-xs font-medium uppercase tracking-wider">Node Info</span>
                  </div>
                  <button onClick={() => setSelectedNode(null)} className="text-neutral-500 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <h2 className="text-lg font-bold text-white mb-2 leading-tight">
                  {selectedNode.title}
                </h2>

                <div className="flex flex-col gap-1 mb-4">
                  <div className="text-sm flex items-center justify-between text-neutral-400 font-mono">
                    <span>ID</span>
                    <span className="text-white">{selectedNode.id}</span>
                  </div>
                  <div className="text-sm flex items-center justify-between text-neutral-400">
                    <span className="flex items-center gap-1"><Tag className="w-3 h-3"/> Category</span>
                    <span className="text-white font-medium" style={{ color: CATEGORIES[selectedNode.mainCatId]?.color || DEFAULT_COLOR }}>
                      {CATEGORIES[selectedNode.mainCatId]?.name || 'Other'}
                    </span>
                  </div>
                </div>

                <a
                    href={`https://simple.wikipedia.org/wiki/${selectedNode.title}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 py-2 mb-2 text-xs font-medium text-neutral-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors"
                >
                  Open on Wikipedia <ExternalLink className="w-3 h-3" />
                </a>

                <div className="pt-3 border-t border-white/10 flex gap-2">
                  <button onClick={() => pickStart(selectedNode)} className="flex-1 py-2 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs font-medium rounded-lg transition-colors border border-emerald-500/20">
                    Set Start
                  </button>
                  <button onClick={() => pickEnd(selectedNode)} className="flex-1 py-2 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 text-xs font-medium rounded-lg transition-colors border border-rose-500/20">
                    Set End
                  </button>
                </div>
              </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {toast && (
              <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute top-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-4 py-2.5 bg-neutral-900/95 border border-rose-500/30 rounded-xl shadow-2xl no-raycast"
              >
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span className="text-xs text-neutral-200">{toast}</span>
                <button onClick={() => setToast(null)} className="text-neutral-500 hover:text-white ml-1">
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {pathData && pathTitles.length > 0 && (
              <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute bottom-40 left-1/2 -translate-x-1/2 z-10 max-w-[92vw] sm:max-w-lg no-raycast"
              >
                <div className="flex items-center gap-2 mb-2 px-1 text-neutral-400 text-[10px] uppercase tracking-widest">
                  <Route className="w-3 h-3" /> {pathTitles.length - 1} hops
                </div>
                <div className="flex flex-wrap items-center gap-1.5 justify-center bg-neutral-900/90 backdrop-blur-xl border border-white/10 rounded-xl px-3 py-2 max-h-28 overflow-y-auto">
                  {pathTitles.map((title, i) => (
                      <span key={i} className="flex items-center gap-1.5">
                        <span className={`text-xs px-2 py-0.5 rounded-md ${
                            i === 0 ? 'bg-emerald-500/15 text-emerald-400' :
                                i === pathTitles.length - 1 ? 'bg-rose-500/15 text-rose-400' :
                                    'bg-white/5 text-neutral-300'
                        }`}>
                          {title}
                        </span>
                        {i < pathTitles.length - 1 && <ChevronRight className="w-3 h-3 text-neutral-600" />}
                      </span>
                  ))}
                </div>
              </motion.div>
          )}
        </AnimatePresence>

        <div className="absolute inset-0 cursor-crosshair">
          <ForceGraph3D
              ref={graphRef}
              graphData={graphData}
              nodeColor={node => node.color}
              nodeRelSize={pathData ? 9 : 5}
              nodeResolution={12}
              enableNodeDrag={false}
              cooldownTicks={0}
              linkColor={() => PATH_LINK_COLOR}
              linkOpacity={0.95}
              linkWidth={3}
              linkDirectionalParticles={6}
              linkDirectionalParticleWidth={3.5}
              linkDirectionalParticleSpeed={0.006}
              linkDirectionalParticleColor={() => PATH_PARTICLE_COLOR}
              backgroundColor="#000000"
              showNavInfo={false}
          />
        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-3 no-raycast w-[min(92vw,640px)] sm:w-auto">
          <div className="flex gap-2 p-1 bg-neutral-900/80 backdrop-blur-xl rounded-xl border border-white/10">
            <button onClick={() => setViewMode('galaxy')} className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 transition-all ${viewMode === 'galaxy' ? 'bg-neutral-700 text-white shadow-sm' : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'}`}>
              <Globe className="w-3.5 h-3.5" /> <span className="hidden sm:inline">AI Clusters</span>
            </button>
            <button onClick={() => setViewMode('plane')} className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 transition-all ${viewMode === 'plane' ? 'bg-neutral-700 text-white shadow-sm' : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'}`}>
              <MapIcon className="w-3.5 h-3.5" /> <span className="hidden sm:inline">2D Plane</span>
            </button>
            <button onClick={() => setViewMode('cube')} className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 transition-all ${viewMode === 'cube' ? 'bg-neutral-700 text-white shadow-sm' : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'}`}>
              <Box className="w-3.5 h-3.5" /> <span className="hidden sm:inline">3D Grid</span>
            </button>
            <button onClick={resetView} title="Reset camera" className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 text-neutral-400 hover:text-white hover:bg-neutral-800/50 transition-all">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-1.5 bg-neutral-900/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl w-full sm:w-auto">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <div className="flex items-center px-3 py-1.5 bg-black/50 rounded-xl border border-white/5">
                  <Search className="w-3.5 h-3.5 text-neutral-500 mr-2 shrink-0" />
                  <input
                      type="text"
                      value={startQuery}
                      onFocus={() => setActiveField('start')}
                      onChange={(e) => { setStartQuery(e.target.value); setStartId(''); }}
                      className="w-full sm:w-32 bg-transparent text-sm text-white focus:outline-none"
                      placeholder="Search start article…"
                  />
                </div>
                {activeField === 'start' && startSuggestions.length > 0 && (
                    <div className="absolute top-full mt-1 left-0 right-0 sm:w-56 bg-neutral-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-30">
                      {startSuggestions.map(n => (
                          <button key={n.id} onClick={() => pickStart(n)} className="w-full text-left px-3 py-2 text-xs text-neutral-200 hover:bg-white/10">
                            {n.title}
                          </button>
                      ))}
                    </div>
                )}
              </div>

              <ChevronRight className="w-4 h-4 text-neutral-600 shrink-0" />

              <div className="relative flex-1">
                <div className="flex items-center px-3 py-1.5 bg-black/50 rounded-xl border border-white/5">
                  <Search className="w-3.5 h-3.5 text-neutral-500 mr-2 shrink-0" />
                  <input
                      type="text"
                      value={endQuery}
                      onFocus={() => setActiveField('end')}
                      onChange={(e) => { setEndQuery(e.target.value); setEndId(''); }}
                      className="w-full sm:w-32 bg-transparent text-sm text-white focus:outline-none"
                      placeholder="Search end article…"
                  />
                </div>
                {activeField === 'end' && endSuggestions.length > 0 && (
                    <div className="absolute top-full mt-1 left-0 right-0 sm:w-56 bg-neutral-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-30">
                      {endSuggestions.map(n => (
                          <button key={n.id} onClick={() => pickEnd(n)} className="w-full text-left px-3 py-2 text-xs text-neutral-200 hover:bg-white/10">
                            {n.title}
                          </button>
                      ))}
                    </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 justify-end">
              <button onClick={findPath} disabled={loading || !startId || !endId} className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-medium rounded-xl flex items-center gap-2 disabled:opacity-50 whitespace-nowrap">
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : pathData ? `${pathData.length - 1} hops` : 'Search'}
              </button>

              <AnimatePresence>
                {pathData && (
                    <motion.button initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} onClick={() => setPathData(null)} className="p-2 hover:bg-white/10 rounded-full text-neutral-400 hover:text-white">
                      <X className="w-4 h-4" />
                    </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
  );
}