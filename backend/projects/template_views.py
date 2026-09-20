"""API for templates and the template library. Access rules live in ``library.py``."""
from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from . import library
from .directory import is_known
from .models import (HiddenBuiltinTemplate, Project, ProjectTemplate, Team, TemplateComment,
                     TemplateReport, TemplateVote)
from .permissions import get_role
from .serializers import (InstantiateTemplateSerializer, ProjectSerializer, SaveTemplateSerializer,
                          TemplateCommentSerializer, TemplateDetailSerializer,
                          TemplateListItemSerializer, TemplateReportSerializer,
                          TemplateUpdateSerializer)
from .templates import create_project_from_spec, spec_from_project
from .templates_builtin import BUILTIN_TEMPLATES

User = get_user_model()
Visibility = ProjectTemplate.Visibility

_KEY = OpenApiParameter('id', OpenApiTypes.STR, OpenApiParameter.PATH,
                        description='Template key: "saved:<id>" or "builtin:<slug>".')
NOT_FOUND = {'detail': 'Template not found.'}


class VoteThrottle(UserRateThrottle):
    scope = 'template_vote'


class CommentThrottle(UserRateThrottle):
    scope = 'template_comment'


class ReportThrottle(UserRateThrottle):
    scope = 'template_report'


class TemplateViewSet(viewsets.ViewSet):
    """Built-in and saved project templates: the library, and starting a project from one.

    A saved template is private until its owner publishes it. Every endpoint here first asks
    ``library.resolve`` whether the caller may see the template; if not, the answer is 404, the
    same as for a template that does not exist.
    """
    permission_classes = [IsAuthenticated]
    lookup_value_regex = '[^/]+'

    def get_throttles(self):
        if self.request.method in ('POST', 'DELETE', 'PATCH'):
            if self.action == 'vote':
                return [VoteThrottle()]
            if self.action in ('comments', 'comment_detail') and self.request.method != 'DELETE':
                return [CommentThrottle()]
            if self.action == 'report':
                return [ReportThrottle()]
        return []

    # --- Browse -----------------------------------------------------------------------------

    @extend_schema(responses=TemplateListItemSerializer(many=True), parameters=[
        OpenApiParameter('q', OpenApiTypes.STR), OpenApiParameter('group', OpenApiTypes.STR),
        OpenApiParameter('tag', OpenApiTypes.STR),
        OpenApiParameter('scope', OpenApiTypes.STR, enum=['mine', 'shared']),
        OpenApiParameter('sort', OpenApiTypes.STR, enum=list(library.SORTS)),
    ])
    def list(self, request):
        """Every template you may see: the built-ins, your own, and ones shared with you."""
        p = request.query_params
        items = library.describe(library.everything_visible(request.user), request.user)
        return Response(library.search(
            items, q=p.get('q', ''), group=p.get('group', ''), tag=p.get('tag', ''),
            scope=p.get('scope', ''), sort=p.get('sort', 'proven')))

    def _detail(self, found, request):
        item = library.describe([found], request.user)[0]
        item.update(found.spec())
        item['library_mode'] = library.library_mode()
        return item

    @extend_schema(responses=TemplateDetailSerializer, parameters=[_KEY])
    def retrieve(self, request, pk=None):
        """One template with its whole plan, for the preview."""
        found = library.resolve(pk, request.user)
        if not found:
            return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
        return Response(self._detail(found, request))

    # --- Save, edit, publish, delete ----------------------------------------------------------

    @extend_schema(request=SaveTemplateSerializer, responses=TemplateListItemSerializer)
    def create(self, request):
        """Save an existing project (that you're a member of) as a reusable template."""
        serializer = SaveTemplateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if get_role(request.user, data['project']) is None:
            return Response({'detail': 'You are not a member of that project.'},
                            status=status.HTTP_403_FORBIDDEN)
        project = Project.objects.get(pk=data['project'])
        spec = spec_from_project(project)
        tpl = ProjectTemplate.objects.create(
            owner=request.user, name=data['name'], description=data.get('description', ''),
            categories=spec['categories'], tasks=spec['tasks'],
        )
        found = library.Resolved(f'saved:{tpl.id}', saved=tpl, user=request.user)
        return Response(library.describe([found], request.user)[0], status=status.HTTP_201_CREATED)

    @extend_schema(request=TemplateUpdateSerializer, responses=TemplateDetailSerializer, parameters=[_KEY])
    def partial_update(self, request, pk=None):
        """Edit a template's details, or publish it by changing ``visibility``. Owner only."""
        found = library.resolve(pk, request.user)
        if not found:
            return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
        if not found.is_mine:
            return Response({'detail': 'Only the person who saved a template can change it.'},
                            status=status.HTTP_403_FORBIDDEN)
        tpl = found.saved
        serializer = TemplateUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        visibility = data.get('visibility', tpl.visibility)
        if 'visibility' in data and visibility not in library.allowed_visibilities():
            return Response({'visibility': 'This server does not allow templates to be shared that widely.'},
                            status=status.HTTP_400_BAD_REQUEST)

        teams = None
        if 'shared_with_teams' in data:
            # You can share with a team you own or belong to, and no other. The ids come from the
            # client, so each one is checked against the database.
            mine = set(library.my_team_ids(request.user))
            wanted = set(data['shared_with_teams'])
            if not wanted <= mine:
                return Response({'shared_with_teams': 'You can only share with teams you belong to.'},
                                status=status.HTTP_400_BAD_REQUEST)
            teams = Team.objects.filter(id__in=wanted)
        if visibility == Visibility.TEAMS:
            chosen = teams if teams is not None else tpl.shared_with_teams.all()
            if not chosen.exists():
                return Response({'shared_with_teams': 'Choose at least one team to share with.'},
                                status=status.HTTP_400_BAD_REQUEST)

        for field in ('name', 'description', 'summary', 'group', 'tags', 'author_display',
                      'share_notes', 'share_todos'):
            if field in data:
                setattr(tpl, field, data[field])
        if visibility != tpl.visibility:
            tpl.visibility = visibility
            tpl.published_at = None if visibility == Visibility.PRIVATE else timezone.now()
        tpl.save()
        if teams is not None:
            tpl.shared_with_teams.set(teams)
        if tpl.visibility != Visibility.TEAMS:
            tpl.shared_with_teams.clear()
        found = library.Resolved(found.key, saved=tpl, user=request.user)
        return Response(self._detail(found, request))

    @extend_schema(request=None, responses=TemplateDetailSerializer, parameters=[_KEY])
    @action(detail=True, methods=['post'])
    def unpublish(self, request, pk=None):
        """Make a template private again. Its owner, or staff (moderation)."""
        found = library.resolve(pk, request.user)
        if not found or not found.saved:
            return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
        if not (found.is_mine or request.user.is_staff):
            return Response({'detail': 'Only its owner or an admin can unpublish a template.'},
                            status=status.HTTP_403_FORBIDDEN)
        tpl = found.saved
        tpl.visibility, tpl.published_at = Visibility.PRIVATE, None
        tpl.save()
        tpl.shared_with_teams.clear()
        if not found.is_mine:                   # staff no longer see it once it is private
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(self._detail(library.Resolved(found.key, saved=tpl, user=request.user), request))

    @extend_schema(responses=None, parameters=[_KEY])
    def destroy(self, request, pk=None):
        """Delete one of your own saved templates, or (admins) retire a built-in for everyone."""
        key = library.normalise_key(pk)
        kind, _, ident = key.partition(':')
        if kind == 'builtin':
            return self._retire_builtin(request, ident)
        try:
            deleted, _ = ProjectTemplate.objects.filter(pk=int(ident), owner=request.user).delete()
        except ValueError:
            deleted = 0
        if not deleted:
            return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
        TemplateVote.objects.filter(template_key=key).delete()
        TemplateComment.objects.filter(template_key=key).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _retire_builtin(self, request, slug):
        """Hide a built-in template for everyone. Restricted to admin (staff) accounts."""
        if not request.user.is_staff:
            return Response({'detail': 'Only admins can delete built-in templates.'},
                            status=status.HTTP_403_FORBIDDEN)
        if slug not in BUILTIN_TEMPLATES:
            return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
        HiddenBuiltinTemplate.objects.get_or_create(slug=slug, defaults={'hidden_by': request.user})
        return Response(status=status.HTTP_204_NO_CONTENT)

    # --- Use ----------------------------------------------------------------------------------

    @extend_schema(request=None, responses=TemplateDetailSerializer, parameters=[_KEY])
    @action(detail=True, methods=['post'])
    def fork(self, request, pk=None):
        """Make my own copy: a private template of yours to adapt, which remembers its origin."""
        found = library.resolve(pk, request.user)
        if not found:
            return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
        spec = found.spec()
        src = found.saved
        tpl = ProjectTemplate.objects.create(
            owner=request.user, name=f'{found.name} (my copy)'[:200], description=found.description,
            categories=spec['categories'], tasks=spec['tasks'],
            summary=src.summary if src else '', tags=list(src.tags or []) if src else [],
            group=src.group if src else library.BUILTIN_GROUPS.get(found.key.split(':', 1)[1], 'other'),
            forked_from_key=found.key,
        )
        mine = library.Resolved(f'saved:{tpl.id}', saved=tpl, user=request.user)
        return Response(self._detail(mine, request), status=status.HTTP_201_CREATED)

    @extend_schema(request=InstantiateTemplateSerializer, responses=ProjectSerializer)
    @action(detail=False, methods=['post'])
    def instantiate(self, request):
        """Create a project from a template, anchored to a start date, for a chosen owner."""
        serializer = InstantiateTemplateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        found = library.resolve(data['key'], request.user)
        if found is None:
            return Response({'detail': 'Unknown template.'}, status=status.HTTP_400_BAD_REQUEST)
        spec = found.spec()

        identifier = (data.get('owner') or '').strip()
        if identifier:
            target = (User.objects.filter(email__iexact=identifier).first()
                      or User.objects.filter(username__iexact=identifier).first())
            # You can set up a project for someone you already work with, not for any account in the
            # system: otherwise anyone could drop unsolicited projects into a stranger's list. The
            # same message covers "no such user" so this cannot be used to discover accounts.
            if not target or not target.is_active or not is_known(request.user, target):
                return Response({'owner': 'You can only create a project for yourself or for someone you already '
                                          'share a project or team with.'}, status=status.HTTP_400_BAD_REQUEST)
        else:
            target = request.user

        project = create_project_from_spec(
            spec,
            name=(data.get('name') or found.name),
            description=(data.get('description') or found.description),
            start=data['start'],
            owner=target,
            also_owner=request.user,
            source_key=found.key,
        )
        return Response(
            ProjectSerializer(project, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    # --- Votes, comments, reports ---------------------------------------------------------------

    @extend_schema(request=None, responses=TemplateListItemSerializer, parameters=[_KEY])
    @action(detail=True, methods=['post', 'delete'])
    def vote(self, request, pk=None):
        """POST to upvote, DELETE to take it back. One vote per person; yours included."""
        found = library.resolve(pk, request.user)
        if not found:
            return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
        if request.method == 'POST':
            TemplateVote.objects.get_or_create(user=request.user, template_key=found.key)
        else:
            TemplateVote.objects.filter(user=request.user, template_key=found.key).delete()
        return Response(library.describe([found], request.user)[0])

    @extend_schema(request=TemplateCommentSerializer, responses=TemplateCommentSerializer(many=True),
                   parameters=[_KEY])
    @action(detail=True, methods=['get', 'post'])
    def comments(self, request, pk=None):
        found = library.resolve(pk, request.user)
        if not found:
            return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
        ctx = {'request': request, 'template': found}
        if request.method == 'POST':
            serializer = TemplateCommentSerializer(data=request.data, context=ctx)
            serializer.is_valid(raise_exception=True)
            serializer.save(author=request.user, template_key=found.key)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        rows = TemplateComment.objects.filter(template_key=found.key).select_related('author')
        return Response(TemplateCommentSerializer(rows, many=True, context=ctx).data)

    @extend_schema(request=TemplateCommentSerializer, responses=TemplateCommentSerializer, parameters=[
        _KEY, OpenApiParameter('comment_id', OpenApiTypes.INT, OpenApiParameter.PATH)])
    @action(detail=True, methods=['patch', 'delete'], url_path=r'comments/(?P<comment_id>\d+)')
    def comment_detail(self, request, pk=None, comment_id=None):
        """Edit your own comment. Delete: its author, the template's owner, or staff."""
        found = library.resolve(pk, request.user)
        if not found:
            return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
        comment = get_object_or_404(TemplateComment, pk=comment_id, template_key=found.key)
        is_author = comment.author_id == request.user.id
        if request.method == 'DELETE':
            if not (is_author or found.is_mine or request.user.is_staff):
                return Response({'detail': 'Only its author, the template owner or an admin can delete this.'},
                                status=status.HTTP_403_FORBIDDEN)
            comment.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        if not is_author:
            return Response({'detail': 'Only its author can edit a comment.'},
                            status=status.HTTP_403_FORBIDDEN)
        ctx = {'request': request, 'template': found}
        serializer = TemplateCommentSerializer(comment, data=request.data, partial=True, context=ctx)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    @extend_schema(request=TemplateReportSerializer, responses=None, parameters=[_KEY])
    @action(detail=True, methods=['post'])
    def report(self, request, pk=None):
        """Flag a template, or one comment on it, for an admin to look at."""
        found = library.resolve(pk, request.user)
        if not found:
            return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
        serializer = TemplateReportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = None
        if serializer.validated_data.get('comment'):
            comment = get_object_or_404(TemplateComment, pk=serializer.validated_data['comment'],
                                        template_key=found.key)
        TemplateReport.objects.create(reporter=request.user, template_key=found.key, comment=comment,
                                      reason=serializer.validated_data.get('reason', ''))
        return Response(status=status.HTTP_204_NO_CONTENT)
