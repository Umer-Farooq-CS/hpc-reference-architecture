document$.subscribe(function() {
    // 1. Theme switcher logic
    function updateThemeImages() {
        const isDark = document.body.getAttribute('data-md-color-scheme') === 'slate';
        document.querySelectorAll('object.mermaid-svg').forEach(obj => {
            const currentData = obj.getAttribute('data');
            if (!currentData) return;
            
            if (isDark && !currentData.endsWith('_dark.svg')) {
                obj.setAttribute('data', currentData.replace('.svg', '_dark.svg'));
                obj.classList.remove('zoom-initialized');
            } else if (!isDark && currentData.endsWith('_dark.svg')) {
                obj.setAttribute('data', currentData.replace('_dark.svg', '.svg'));
                obj.classList.remove('zoom-initialized');
            }
        });
    }

    updateThemeImages();

    // 2. Zoom initialization logic
    function initZoom() {
        document.querySelectorAll('object.mermaid-svg').forEach((obj) => {
            if (obj.classList.contains('zoom-initialized')) return;
            
            const svgDoc = obj.contentDocument;
            if (svgDoc && svgDoc.readyState === 'complete') {
                const svg = svgDoc.querySelector('svg');
                if (svg) {
                    obj.classList.add('zoom-initialized');
                    
                    // A. Calculate perfect aspect-ratio height
                    let targetHeight = 600; 
                    const viewBox = svg.getAttribute('viewBox');
                    if (viewBox) {
                        const [, , vbWidth, vbHeight] = viewBox.split(' ').map(Number);
                        const aspectRatio = vbWidth / vbHeight;
                        
                        // The CSS makes the box wider (e.g. 140% of the column). 
                        // We use clientWidth to calculate the proportional height perfectly.
                        const containerWidth = obj.parentElement.clientWidth || 1000;
                        targetHeight = containerWidth / aspectRatio;
                        
                        // Clamp it with a very generous max height so big diagrams are huge
                        // For extreme sequence diagrams, we allow up to 8000px height.
                        targetHeight = Math.max(300, Math.min(8000, targetHeight)); 
                        
                        // User specifically requested the tall diagrams to be manually larger (artificially increased height)
                        if (obj.classList.contains('mermaid-svg-tall')) {
                            targetHeight = targetHeight * 1.5;
                        }
                    }
                    obj.style.height = targetHeight + "px";
                    
                    // B. Make SVG fill the container
                    svg.style.width = "100%";
                    svg.style.height = "100%";
                    
                    // C. Initialize svg-pan-zoom
                    const pz = svgPanZoom(svg, {
                        zoomEnabled: true,
                        controlIconsEnabled: true,
                        fit: true,
                        center: true,
                        minZoom: 0.2,
                        maxZoom: 10
                    });

                    // Create wrapper and fullscreen button if they don't exist
                    let wrapper = obj.parentElement;
                    if (!wrapper.classList.contains('mermaid-wrapper')) {
                        wrapper = document.createElement('div');
                        wrapper.className = 'mermaid-wrapper';
                        wrapper.style.position = 'relative';
                        wrapper.style.width = '100%';
                        obj.parentNode.insertBefore(wrapper, obj);
                        wrapper.appendChild(obj);
                        
                        const fsBtn = document.createElement('button');
                        fsBtn.className = 'mermaid-fs-btn';
                        fsBtn.innerHTML = '⛶ Fullscreen';
                        wrapper.appendChild(fsBtn);
                        
                        // Placeholder to remember where the diagram belongs in the document
                        const placeholder = document.createElement('div');
                        
                        fsBtn.addEventListener('click', function() {
                            const isFs = wrapper.classList.contains('fullscreen-mode');
                            
                            // The <object> will reload when moved in the DOM. 
                            // We remove the initialized class so initZoom picks it up again when it reloads!
                            obj.classList.remove('zoom-initialized');
                            
                            if (!isFs) {
                                // Enter fullscreen: move to body to escape all layout traps
                                wrapper.parentNode.insertBefore(placeholder, wrapper);
                                document.body.appendChild(wrapper);
                                wrapper.classList.add('fullscreen-mode');
                                fsBtn.innerHTML = '✖ Exit Fullscreen';
                                document.body.style.overflow = 'hidden'; // Stop page scrolling
                            } else {
                                // Exit fullscreen: put back in place
                                placeholder.parentNode.insertBefore(wrapper, placeholder);
                                wrapper.classList.remove('fullscreen-mode');
                                fsBtn.innerHTML = '⛶ Fullscreen';
                                document.body.style.overflow = '';
                            }
                        });
                    }
                    
                    // Apply zoom/pan logic based on fullscreen state
                    const isFullscreen = wrapper.classList.contains('fullscreen-mode');
                    
                    if (obj.classList.contains('mermaid-svg-tall') && !isFullscreen) {
                        pz.zoom(pz.getZoom() * 1.5);
                        pz.center(); 
                        pz.pan({x: pz.getPan().x, y: 20});
                    } else if (obj.classList.contains('mermaid-svg-tall') && isFullscreen) {
                        pz.zoom(pz.getZoom() * 1.2);
                        pz.center();
                        pz.pan({x: pz.getPan().x, y: 20});
                    }

                    // D. Prevent scroll hijacking, but allow diagram panning with mouse wheel
                    svgDoc.addEventListener('wheel', function(e) {
                        e.preventDefault();
                        if (e.ctrlKey || e.metaKey) {
                            if (e.deltaY > 0) pz.zoomOut();
                            else pz.zoomIn();
                        } else if (e.shiftKey) {
                            pz.panBy({ x: -e.deltaY, y: 0 });
                        } else {
                            pz.panBy({ x: -e.deltaX, y: -e.deltaY });
                        }
                    }, { passive: false });
                }
            }
        });
    }

    // Since object loading is asynchronous, listen for load events
    document.querySelectorAll('object.mermaid-svg').forEach((obj) => {
        obj.addEventListener('load', initZoom);
    });

    initZoom();
    let interval = setInterval(initZoom, 1000);
    setTimeout(() => clearInterval(interval), 5000);
});

// 3. Global Observer for Dark/Light toggle
if (!window.mermaidThemeObserverAttached) {
    window.mermaidThemeObserverAttached = true;
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'data-md-color-scheme') {
                const isDark = document.body.getAttribute('data-md-color-scheme') === 'slate';
                document.querySelectorAll('object.mermaid-svg').forEach(obj => {
                    const currentData = obj.getAttribute('data');
                    if (!currentData) return;
                    
                    if (isDark && !currentData.endsWith('_dark.svg')) {
                        obj.setAttribute('data', currentData.replace('.svg', '_dark.svg'));
                        obj.classList.remove('zoom-initialized');
                    } else if (!isDark && currentData.endsWith('_dark.svg')) {
                        obj.setAttribute('data', currentData.replace('_dark.svg', '.svg'));
                        obj.classList.remove('zoom-initialized');
                    }
                });
            }
        });
    });
    observer.observe(document.body, { attributes: true });
}
