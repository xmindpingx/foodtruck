// Draggable game tabs — make them movable cards in the midway section
(function() {
  const DRAGGABLES = document.querySelectorAll('.eolMidTab');
  
  DRAGGABLES.forEach(function(el) {
    makeDraggable(el);
  });

  function makeDraggable(el) {
    var isDragging = false, startX, startY, initialLeft, initialTop;

    el.addEventListener('mousedown', function(e) {
      // Only drag if clicking the card background, not buttons inside
      if (e.target.tagName === 'BUTTON') return;
      
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = el.offsetLeft;
      initialTop = el.offsetTop;
    });

    document.addEventListener('mousemove', function(e) {
      if (!isDragging) return;
      
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      
      el.style.left = initialLeft + dx + 'px';
      el.style.top = initialTop + dy + 'px';
    });

    function stopDrag() {
      if (isDragging) {
        isDragging = false;
      }
    }

    document.addEventListener('mouseup', stopDrag);
    
    el.addEventListener('click', function(e) {
      // Don't trigger drag on actual button clicks
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      e.stopPropagation();
    });
  }
})();
