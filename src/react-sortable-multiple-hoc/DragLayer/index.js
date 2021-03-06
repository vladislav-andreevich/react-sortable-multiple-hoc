import {
  events,
  vendorPrefix,
  getOffset,
  getElementMargin,
  clamp,
} from '../utils';
import {closestRect, updateDistanceBetweenContainers} from './utils';

let oldy = Infinity;

export default class DragLayer {
  helper = null;
  lists = [];

  addRef(list) {
    this.lists.push(list);
  }

  removeRef(list) {
    const i = this.lists.indexOf(list);
    if (i !== -1) {
      this.lists.splice(i, 1);
    }
  }

  startDrag(parent, list, e) {
    const offset = getOffset(e);
    const activeNode = list.manager.getActive();
    this.scrollContainer = this.getScrollContainer(activeNode.node);
    if (!this.scrollContainer){
      this.scrollContainer = list.container;
    }
    if (activeNode) {
      const {
        axis,
        useWindowAsScrollContainer,
      } = list.props;
      const {node} = activeNode;
      const {index} = node.sortableInfo;
      this.startItemID = index;
      const margin = getElementMargin(node);
      const containerBoundingRect = list.container.getBoundingClientRect();
      this.marginOffset = {
        x: margin.left + margin.right,
        y: Math.max(margin.top, margin.bottom),
      };
      this.boundingClientRect = node.getBoundingClientRect();
      this.containerBoundingRect = containerBoundingRect;
      this.currentList = list;

      this.axis = {
        x: axis.indexOf('x') >= 0,
        y: axis.indexOf('y') >= 0,
      };
      this.initialOffset = offset;
      this.distanceBetweenContainers = {
        x: 0,
        y: 0,
      };

      this.listenerNode = e.touches ? node : list.contentWindow;
      events.move.forEach(eventName =>
        this.listenerNode.addEventListener(
          eventName,
          this.handleSortMove,
          false,
        ));
      events.end.forEach(eventName =>
        this.listenerNode.addEventListener(
          eventName,
          this.handleSortEnd,
          false,
        ));

      return activeNode;
    }
    return false;
  }

  createHelper(parent, list){
    const {node, collection} = list.manager.getActive();
    const {index} = node.sortableInfo;
    const fields = node.querySelectorAll('input, textarea, select');
    const clonedNode = node.cloneNode(true);
    const margin = getElementMargin(node);
    const dimensions = list.props.getHelperDimensions({index, node, collection});
    this.width = dimensions.width;
    this.height = dimensions.height;
    const clonedFields = [
      ...clonedNode.querySelectorAll('input, textarea, select'),
    ]; // Convert NodeList to Array

    this.offsetEdge = this.currentList.getEdgeOffset(node);

    clonedFields.forEach((field, index) => {
      if (field.type !== 'file' && fields[index]) {
        field.value = fields[index].value;
      }
    });

    this.helper = parent.appendChild(clonedNode);
    this.helper.style.position = 'fixed';

    this.helper.style.top = `${this.boundingClientRect.top - margin.top}px`;
    this.helper.style.left = `${this.boundingClientRect.left -
      margin.left}px`;
    this.helper.style.width = `${this.width}px`;
    this.helper.style.height = `${this.height}px`;
    this.helper.style.boxSizing = 'border-box';
    this.helper.style.pointerEvents = 'none';

    const {
      useWindowAsScrollContainer,
    } = list.props;
    const containerBoundingRect = this.scrollContainer.getBoundingClientRect();
    this.minTranslate = {};
    this.maxTranslate = {};
    if (this.axis.x) {
      this.minTranslate.x = (useWindowAsScrollContainer
        ? 0
        : containerBoundingRect.left) -
        this.boundingClientRect.left -
        this.width / 2;
      this.maxTranslate.x = (useWindowAsScrollContainer
        ? list.contentWindow.innerWidth
        : containerBoundingRect.left + containerBoundingRect.width) -
        this.boundingClientRect.left -
        this.width / 2;
    }
    if (this.axis.y) {
      this.minTranslate.y = (useWindowAsScrollContainer
        ? 0
        : containerBoundingRect.top) -
        this.boundingClientRect.top -
        this.height / 2;
      this.maxTranslate.y = (useWindowAsScrollContainer
        ? list.contentWindow.innerHeight
        : containerBoundingRect.top + containerBoundingRect.height) -
        this.boundingClientRect.top -
        this.height / 2;
    }
  }

  stopDrag() {
    this.handleSortEnd();
  }

  handleSortMove = e => {
    e.preventDefault(); // Prevent scrolling on mobile
    this.updatePosition(e);
    this.updateTargetContainer(e);
    if (this.currentList) {
      this.currentList.handleSortMove(e);
    }
  };

  handleSortEnd = e => {
    if (this.listenerNode) {
      events.move.forEach(eventName =>
        this.listenerNode.removeEventListener(eventName, this.handleSortMove));
      events.end.forEach(eventName =>
        this.listenerNode.removeEventListener(eventName, this.handleSortEnd));
    }

    if (typeof this.onDragEnd === 'function') {
      this.onDragEnd();
    }
    // Remove the helper from the DOM
    if (this.helper) {
      this.helper.parentNode.removeChild(this.helper);
      this.helper = null;
      this.currentList.handleSortEnd(e);
    }
  };

  updatePosition(e) {
    const {lockAxis, lockToContainerEdges} = this.currentList.props;
    const offset = getOffset(e);
    const translate = {
      x: offset.x - this.initialOffset.x,
      y: offset.y - this.initialOffset.y,
    };
    // Adjust for window scroll
    if (this.currentList.initialWindowScroll){
      translate.y -= (window.scrollY - this.currentList.initialWindowScroll.top);
      translate.x -= (window.scrollX - this.currentList.initialWindowScroll.left);
    }

    this.translate = translate;
    this.delta = offset;

    if (lockToContainerEdges) {
      const [
        minLockOffset,
        maxLockOffset,
      ] = this.currentList.getLockPixelOffsets();
      const minOffset = {
        x: this.width / 2 - minLockOffset.x,
        y: this.height / 2 - minLockOffset.y,
      };
      const maxOffset = {
        x: this.width / 2 - maxLockOffset.x,
        y: this.height / 2 - maxLockOffset.y,
      };

      translate.x = clamp(
        translate.x,
        this.minTranslate.x + minOffset.x,
        this.maxTranslate.x - maxOffset.x,
      );
      translate.y = clamp(
        translate.y,
        this.minTranslate.y + minOffset.y,
        this.maxTranslate.y - maxOffset.y,
      );
    }

    if (lockAxis === 'x') {
      translate.y = 0;
    } else if (lockAxis === 'y') {
      translate.x = 0;
    }

    this.helper.style[
      `${vendorPrefix}Transform`
    ] = `translate3d(${translate.x}px,${translate.y}px, 0)`;
  }

  updateTargetContainer(e) {
    let {pageX, pageY} = this.delta;
    const helperCollision = this.currentList.props.helperCollision;
    if (helperCollision){
      const {top, bottom} = this.helper.getBoundingClientRect();
      if (pageY > oldy){
        pageY=bottom+helperCollision.top;
      }else{
        pageY=top+helperCollision.top;
      }
    }
    oldy = e.pageY;
    const closest = this.lists[closestRect(pageX, pageY, this.lists.map(l => l.container))];
    const {item} = this.currentList.manager.active;
    this.active = item;
    if (closest !== this.currentList) {
      this.distanceBetweenContainers = updateDistanceBetweenContainers(
        this.distanceBetweenContainers,
        closest,
        this.currentList,
        {
          width: this.width,
          height: this.height,
        },
      );
      this.currentList.handleSortEnd(e, closest, {pageX, pageY});
      this.currentList = closest;
      this.currentList.manager.active = {
        ...this.currentList.getClosestNode(e),
        item,
      };
      this.currentList.handlePress(e);
    }
  }

  updateDistanceBetweenContainers(){
    const containerCoordinates = this.currentList.container.getBoundingClientRect();
    this.distanceBetweenContainers = {
      x: containerCoordinates.left - this.containerBoundingRect.left,
      y: containerCoordinates.top - this.containerBoundingRect.top,
    };
  }

  getScrollContainer(listContainer){
    let el = listContainer;
    while (el.parentNode){
      if (el.style.overflow){
        return el;
      }
      el = el.parentNode;
    }
  }
}
    width: this.width,
                    height: this.height,
                },
      );
            this.currentList.handleSortEnd(e, closest, { pageX, pageY });
            this.currentList = closest;
            this.currentList.manager.active = {
                ...this.currentList.getClosestNode(e),
                item,
            };
            this.currentList.handlePress(e);
        }
    }

    updateDistanceBetweenContainers() {
        const containerCoordinates = this.currentList.container.getBoundingClientRect();

        this.distanceBetweenContainers = {
            x: containerCoordinates.left - this.containerBoundingRect.left,
            y: containerCoordinates.top - this.containerBoundingRect.top,
        };
    }

    getScrollContainer(listContainer) {
        let el = listContainer;

        while (el.parentNode) {
            if (el.style.overflow) {
                return el;
            }
            el = el.parentNode;
        }
    }
}
