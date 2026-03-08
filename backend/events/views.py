from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Category, Event
from .serializers import CategorySerializer, EventSerializer


class CategoryViewSet(viewsets.ModelViewSet):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']


class EventViewSet(viewsets.ModelViewSet):
    queryset = Event.objects.prefetch_related('depends_on').all()
    serializer_class = EventSerializer
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_queryset(self):
        qs = super().get_queryset()
        category = self.request.query_params.get('category')
        if category:
            qs = qs.filter(category=category)
        return qs

    @action(detail=False, methods=['post'], url_path='bulk')
    def bulk_create(self, request):
        """POST /api/events/bulk/ — create multiple events at once."""
        if not isinstance(request.data, list):
            return Response({'detail': 'Expected a list.'}, status=status.HTTP_400_BAD_REQUEST)
        serializer = EventSerializer(data=request.data, many=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)
